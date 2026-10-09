
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();

const db = admin.firestore();
const ADMIN_UID = "fatArQtywpak9xoPiS6gPvFSCZx2";
const TIME_ZONE = "America/Sao_Paulo";
const DURATION_MINUTES = 60;

const GOOGLE_CLIENT_ID = defineSecret("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");
const GOOGLE_REFRESH_TOKEN = defineSecret("GOOGLE_REFRESH_TOKEN");

function getCalendarClient() {
  const oauth = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID.value(),
    GOOGLE_CLIENT_SECRET.value()
  );

  oauth.setCredentials({
    refresh_token: GOOGLE_REFRESH_TOKEN.value()
  });

  return google.calendar({ version: "v3", auth: oauth });
}

function getInterval(data, horario) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(data || "") ||
    !/^\d{2}:\d{2}$/.test(horario || "")
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Data ou horário inválido."
    );
  }

  const start = new Date(`${data}T${horario}:00-03:00`);
  const end = new Date(start.getTime() + DURATION_MINUTES * 60000);

  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== data ||
    start.getTime() <= Date.now()
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Escolha uma data e horário futuros válidos."
    );
  }

  return { start, end };
}

function getLockIds(start, end) {
  const ids = [];
  const block = 15 * 60 * 1000;

  let time = Math.floor(start.getTime() / block) * block;
  const last = Math.ceil(end.getTime() / block) * block;

  while (time < last) {
    const d = new Date(time);
    const date = d.toLocaleDateString("en-CA", {
      timeZone: TIME_ZONE
    });
    const hm = d.toLocaleTimeString("en-GB", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).replace(":", "");

    ids.push(`${date}_${hm}`);
    time += block;
  }

  return ids;
}

exports.confirmarReuniao = onCall(
  {
    region: "southamerica-east1",
    secrets: [
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REFRESH_TOKEN
    ],
    timeoutSeconds: 120
  },
  async (request) => {
    if (!request.auth || request.auth.uid !== ADMIN_UID) {
      throw new HttpsError(
        "permission-denied",
        "Somente o administrador autorizado pode confirmar reuniões."
      );
    }

    const requestId = request.data?.requestId;

    if (
      typeof requestId !== "string" ||
      !/^[A-Za-z0-9_-]{1,150}$/.test(requestId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Identificador da solicitação inválido."
      );
    }

    const requestRef = db.collection("solicitacoesPublicas").doc(requestId);
    const initialSnap = await requestRef.get();

    if (!initialSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Solicitação não encontrada."
      );
    }

    const initialData = initialSnap.data();

    // Repetir uma confirmação já concluída não deve criar outro evento.
    if (initialData.status === "confirmada") {
      const existing = await db.collection("agendamentos")
        .where("sourceRequestId", "==", requestId)
        .limit(1)
        .get();

      if (!existing.empty) {
        const booking = existing.docs[0].data();
        return {
          ok: true,
          alreadyConfirmed: true,
          meetLink: booking.meetLink || null
        };
      }

      throw new HttpsError(
        "failed-precondition",
        "A solicitação já foi confirmada, mas o agendamento precisa ser verificado."
      );
    }

    if (initialData.status !== "pendente") {
      throw new HttpsError(
        "failed-precondition",
        "Somente solicitações pendentes podem ser confirmadas."
      );
    }

    const { start, end } = getInterval(
      initialData.data,
      initialData.horario
    );

    const calendar = getCalendarClient();
    const lockIds = getLockIds(start, end);
    const lockRefs = lockIds.map(id =>
      db.collection("bloqueiosHorarios").doc(id)
    );

    // Reserva os intervalos antes de consultar/criar o evento.
    await db.runTransaction(async tx => {
      const current = await tx.get(requestRef);

      if (!current.exists || current.data().status !== "pendente") {
        throw new HttpsError(
          "failed-precondition",
          "Esta solicitação não está mais pendente."
        );
      }

      const locks = [];
      for (const ref of lockRefs) {
        locks.push(await tx.get(ref));
      }

      if (locks.some(s => s.exists)) {
        throw new HttpsError(
          "already-exists",
          "Este horário está reservado por outra confirmação."
        );
      }

      lockRefs.forEach(ref => {
        tx.create(ref, {
          requestId,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    let eventId = null;

    try {
      const freeBusy = await calendar.freebusy.query({
        requestBody: {
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          timeZone: TIME_ZONE,
          items: [{ id: "primary" }]
        }
      });

      const calendars = freeBusy.data.calendars || {};
      const busy = calendars.primary?.busy || [];

      if (busy.length > 0) {
        throw new HttpsError(
          "failed-precondition",
          "Sua agenda do Google já possui um compromisso nesse intervalo."
        );
      }

      const event = await calendar.events.insert({
        calendarId: "primary",
        conferenceDataVersion: 1,
        sendUpdates: "all",
        requestBody: {
          summary: `Reunião SBS - ${initialData.nome}`,
          description: [
            `Assunto: ${initialData.assunto || "Não informado"}`,
            `Solicitante: ${initialData.nome}`,
            `E-mail: ${initialData.email}`,
            `Identificador: ${requestId}`
          ].join("\n"),
          start: {
            dateTime: start.toISOString(),
            timeZone: TIME_ZONE
          },
          end: {
            dateTime: end.toISOString(),
            timeZone: TIME_ZONE
          },
          attendees: [{ email: initialData.email }],
          conferenceData: {
            createRequest: {
              requestId: `sbs-${requestId}-${Date.now()}`,
              conferenceSolutionKey: { type: "hangoutsMeet" }
            }
          }
        }
      });

      eventId = event.data.id;

      // O Google pode levar alguns instantes para disponibilizar o Meet.
      let savedEvent = event.data;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (
          savedEvent.hangoutLink ||
          savedEvent.conferenceData?.entryPoints?.some(
            p => p.entryPointType === "video"
          )
        ) break;

        await new Promise(resolve => setTimeout(resolve, 1500));

        const refreshed = await calendar.events.get({
          calendarId: "primary",
          eventId
        });
        savedEvent = refreshed.data;
      }

      const meetLink =
        savedEvent.hangoutLink ||
        savedEvent.conferenceData?.entryPoints?.find(
          p => p.entryPointType === "video"
        )?.uri ||
        null;

      const bookingRef = db.collection("agendamentos").doc();
      const batch = db.batch();

      batch.set(bookingRef, {
        client_name: initialData.nome,
        email: initialData.email,
        phone: initialData.telefone || "",
        data: initialData.data,
        horario: initialData.horario,
        durationMinutes: DURATION_MINUTES,
        subject: initialData.assunto || "",
        status: "confirmed",
        meetLink,
        googleCalendarEventId: eventId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceRequestId: requestId
      });

      batch.update(requestRef, {
        status: "confirmada",
        meetLink,
        googleCalendarEventId: eventId,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await batch.commit();

      return {
        ok: true,
        meetLink,
        eventId,
        message: meetLink
          ? "Reunião criada com sucesso."
          : "Evento criado; o Google ainda está gerando o link do Meet."
      };
    } catch (error) {
      // Se o evento foi criado, mas o registro falhou, tenta desfazê-lo.
      if (eventId) {
        try {
          await calendar.events.delete({
            calendarId: "primary",
            eventId,
            sendUpdates: "all"
          });
        } catch (cleanupError) {
          console.error("Não foi possível remover o evento:", cleanupError);
        }
      }

      await db.runTransaction(async tx => {
        const locks = [];
        for (const ref of lockRefs) {
          locks.push(await tx.get(ref));
        }

        locks.forEach((snap, i) => {
          if (
            snap.exists &&
            snap.data().requestId === requestId
          ) {
            tx.delete(lockRefs[i]);
          }
        });
      });

      if (error instanceof HttpsError) throw error;

      console.error("Erro ao confirmar reunião:", error);
      throw new HttpsError(
        "internal",
        "Não foi possível criar a reunião. A solicitação continua disponível para nova tentativa."
      );
    }
  }
);