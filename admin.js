
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const ADMIN_UID = "fatArQtywpak9xoPiS6gPvFSCZx2";
const $ = selector => document.querySelector(selector);

let auth;
let db;
let unsubRequests;
let unsubBookings;

let requestsData = [];
let bookingsData = [];
let activeFilter = "upcoming";

const safe = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

function showFeedback(message) {
  const feedback = $("#feedback");
  if (feedback) feedback.textContent = message;
}

function todayString() {
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 10);
}

function meetingStart(item) {
  if (!item.data) return NaN;

  return new Date(
    `${item.data}T${item.horario || "00:00"}:00`
  ).getTime();
}

function formatDate(date, time) {
  if (!date) return "—";

  const parts = String(date).split("-");

  const formatted = parts.length === 3
    ? `${parts[2]}/${parts[1]}/${parts[0]}`
    : date;

  return `${formatted} ${time || ""}`.trim();
}

function statusText(status) {
  const value = String(status || "").toLowerCase();

  if (["confirmed", "confirmada", "confirmado"].includes(value)) {
    return "Confirmada";
  }

  if (
    ["cancelled", "cancelada", "cancelado", "recusada", "rejected"]
      .includes(value)
  ) {
    return "Cancelada";
  }

  if (["pending", "pendente"].includes(value)) {
    return "Pendente";
  }

  return status || "Confirmada";
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();

  if (["confirmed", "confirmada", "confirmado"].includes(value)) {
    return "confirmed";
  }

  if (
    ["cancelled", "cancelada", "cancelado", "recusada", "rejected"]
      .includes(value)
  ) {
    return "cancelled";
  }

  return "pending";
}

/* Cria a área de solicitações se ela não existir no HTML. */

function ensureRequestsArea() {
  if ($("#requests")) return;

  const dashboard = $("#dashboard");
  const firstCard = dashboard?.querySelector(".card");

  if (!dashboard || !firstCard) {
    console.error(
      "Não foi possível criar a área de solicitações. Confira o elemento #dashboard no HTML."
    );
    return;
  }

  const section = document.createElement("section");
  section.className = "card";

  section.innerHTML = `
    <div class="card-heading">
      <div class="section-icon">📥</div>
      <h2>Solicitações recebidas</h2>
    </div>

    <p class="section-desc">
      Confirme manualmente ou recuse os pedidos recebidos.
    </p>

    <div id="requests" class="list-container" aria-live="polite">
      <p class="muted">Carregando solicitações...</p>
    </div>
  `;

  dashboard.insertBefore(section, firstCard);
}

/* Inicialização do Firebase. */

function initializeFirebase() {
  if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId) {
    throw new Error(
      "A configuração do Firebase está incompleta."
    );
  }

  const app = initializeApp(firebaseConfig);

  auth = getAuth(app);
  db = getFirestore(app);
}

try {
  initializeFirebase();
} catch (error) {
  console.error("Erro ao iniciar Firebase:", error);

  showFeedback(
    "Não foi possível iniciar o Firebase. Confira firebase-config.js."
  );
}

/* Login. */

$("#loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  showFeedback("");

  if (!auth) {
    showFeedback(
      "Firebase não está configurado corretamente."
    );
    return;
  }

  const emailInput = $("#email");
  const passwordInput = $("#password");

  if (!emailInput || !passwordInput) {
    showFeedback(
      "Não foi possível localizar os campos de login no HTML."
    );
    return;
  }

  try {
    await signInWithEmailAndPassword(
      auth,
      emailInput.value.trim(),
      passwordInput.value
    );
  } catch (error) {
    console.error("Erro no login:", error);

    showFeedback(
      "Não foi possível entrar. Confira o e-mail e a senha."
    );
  }
});

/* Logout. */

$("#logout")?.addEventListener("click", async () => {
  if (!auth) return;

  try {
    await signOut(auth);
  } catch (error) {
    console.error("Erro ao sair:", error);
    showFeedback("Não foi possível encerrar a sessão.");
  }
});

/* Autenticação e autorização do administrador. */

if (auth) {
  onAuthStateChanged(auth, user => {
    if (unsubRequests) unsubRequests();
    if (unsubBookings) unsubBookings();

    unsubRequests = null;
    unsubBookings = null;

    const allowed = Boolean(
      user && user.uid === ADMIN_UID
    );

    $("#loginCard")?.classList.toggle("hidden", allowed);
    $("#dashboard")?.classList.toggle("hidden", !allowed);
    $("#logout")?.classList.toggle("hidden", !allowed);

    if (user && !allowed) {
      showFeedback(
        "Esta conta não está autorizada como administradora."
      );

      signOut(auth).catch(error => {
        console.error("Erro ao encerrar sessão não autorizada:", error);
      });

      return;
    }

    if (allowed) {
      showFeedback("");
      ensureRequestsArea();
      loadLists();
    } else {
      requestsData = [];
      bookingsData = [];
    }
  });
}

/* Carrega as solicitações e reuniões em tempo real. */

function loadLists() {
  if (!db || !auth?.currentUser) return;

  if (unsubRequests) unsubRequests();
  if (unsubBookings) unsubBookings();

  unsubRequests = onSnapshot(
    query(
      collection(db, "solicitacoesPublicas"),
      orderBy("createdAt", "desc")
    ),

    snapshot => {
      requestsData = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderRequests();
    },

    error => {
      console.error(
        "Erro ao carregar solicitações:",
        error
      );

      const target = $("#requests");

      if (target) {
        target.innerHTML = `
          <div class="empty">
            Não foi possível carregar as solicitações.
            Confira as permissões e as regras do Firestore.
          </div>
        `;
      }
    }
  );

  unsubBookings = onSnapshot(
    query(
      collection(db, "agendamentos"),
      orderBy("createdAt", "desc")
    ),

    snapshot => {
      bookingsData = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderBookings();
      renderStats();
    },

    error => {
      console.error(
        "Erro ao carregar agendamentos:",
        error
      );

      const target = $("#confirmed");

      if (target) {
        target.innerHTML = `
          <div class="empty">
            Erro ao carregar reuniões.
            Confira as permissões do Firestore.
          </div>
        `;
      }
    }
  );
}

/* Renderiza as solicitações recebidas. */

function renderRequests() {
  const target = $("#requests");

  if (!target) return;

  if (!requestsData.length) {
    target.innerHTML = `
      <div class="empty">
        <div style="font-size:28px;margin-bottom:8px">📭</div>
        <strong>Nenhuma solicitação recebida</strong>
        <p>
          Quando alguém solicitar uma reunião,
          ela aparecerá aqui.
        </p>
      </div>
    `;

    return;
  }

  target.innerHTML = requestsData.map(item => {
    const status = String(
      item.status || "pendente"
    ).toLowerCase();

    const handled = [
      "confirmada",
      "confirmed",
      "recusada",
      "rejected",
      "cancelada",
      "cancelled"
    ].includes(status);

    const initial = safe(
      (item.nome || "C").trim().charAt(0).toUpperCase()
    );

    return `
      <article
        class="item"
        data-request-id="${safe(item.id)}"
      >
        <div class="request-heading">
          <div class="request-person">
            <div class="request-avatar">${initial}</div>

            <div>
              <strong>${safe(item.nome || "Cliente")}</strong>

              <div class="muted" style="margin-top:5px">
                Solicitação de reunião
              </div>
            </div>
          </div>

          <span class="pill ${statusClass(status)}">
            ${safe(statusText(status))}
          </span>
        </div>

        <div class="request-details">
          <div class="request-detail">
            <span class="detail-icon">✉️</span>
            <span>
              ${safe(item.email || "E-mail não informado")}
            </span>
          </div>

          <div class="request-detail">
            <span class="detail-icon">📞</span>
            <span>
              ${safe(item.telefone || "Telefone não informado")}
            </span>
          </div>

          <div class="request-detail">
            <span class="detail-icon">📅</span>
            <span>
              <strong>Data:</strong>
              ${safe(formatDate(item.data, item.horario))}
            </span>
          </div>

          <div class="request-detail">
            <span class="detail-icon">📝</span>
            <span>
              <strong>Assunto:</strong>
              ${safe(item.assunto || "Sem assunto")}
            </span>
          </div>
        </div>

        ${
          handled
            ? `
              <p class="muted" style="margin:14px 0 0">
                Esta solicitação já foi processada.
              </p>
            `
            : `
              <div class="request-actions">
                <button
                  type="button"
                  data-confirm="${safe(item.id)}"
                >
                  ✓ Confirmar reunião
                </button>

                <button
                  type="button"
                  data-reject="${safe(item.id)}"
                >
                  ✕ Recusar
                </button>
              </div>

              <div
                class="request-feedback hidden"
                role="status"
              ></div>
            `
        }
      </article>
    `;
  }).join("");
}

/*
 * CONFIRMAR OU RECUSAR SOLICITAÇÕES
 *
 * A confirmação grava a reunião no Firestore.
 * A criação do evento Google Agenda e do link Meet
 * depende de um backend configurado separadamente.
 */

$("#dashboard")?.addEventListener("click", async event => {
  const button = event.target.closest(
    "#requests button[data-confirm], #requests button[data-reject]"
  );

  if (!button) return;

  event.preventDefault();

  if (!db || !auth?.currentUser) {
    alert(
      "Você precisa estar autenticado para realizar esta ação."
    );
    return;
  }

  if (auth.currentUser.uid !== ADMIN_UID) {
    alert(
      "Sua conta não tem permissão de administrador."
    );
    return;
  }

  const confirmId = button.dataset.confirm;
  const rejectId = button.dataset.reject;
  const requestId = confirmId || rejectId;

  if (!requestId) return;

  const card = button.closest("[data-request-id]");

  if (!card) {
    alert(
      "Não foi possível localizar a solicitação. Atualize a página."
    );
    return;
  }

  const confirmAction = Boolean(confirmId);

  const accepted = window.confirm(
    confirmAction
      ? "Deseja confirmar esta reunião?"
      : "Deseja recusar esta solicitação?"
  );

  if (!accepted) return;

  const buttons = card.querySelectorAll("button");

  buttons.forEach(item => {
    item.disabled = true;
  });

  try {
    const requestRef = doc(
      db,
      "solicitacoesPublicas",
      requestId
    );

    const requestSnapshot = await getDoc(requestRef);

    if (!requestSnapshot.exists()) {
      throw new Error(
        "Esta solicitação não existe mais no Firebase."
      );
    }

    const request = requestSnapshot.data();

    if (
      String(request.status || "").toLowerCase() !== "pendente"
    ) {
      throw new Error(
        "Esta solicitação já foi processada."
      );
    }

    if (confirmAction) {
      if (
        !request.nome ||
        !request.email ||
        !request.data ||
        !request.horario
      ) {
        throw new Error(
          "A solicitação não possui todos os dados necessários."
        );
      }

      /*
       * Registra a reunião confirmada no Firestore.
       * Duração padrão: 60 minutos.
       */

      await addDoc(collection(db, "agendamentos"), {
        client_name: request.nome,
        nome: request.nome,
        email: request.email,
        phone: request.telefone || "",
        data: request.data,
        horario: request.horario,
        durationMinutes: 60,
        subject: request.assunto || "",
        status: "confirmed",
        createdAt: serverTimestamp(),
        sourceRequestId: requestId
      });

      await updateDoc(requestRef, {
        status: "confirmada"
      });

      alert(
        "Reunião registrada e solicitação confirmada."
      );
    } else {
      await updateDoc(requestRef, {
        status: "recusada"
      });

      alert("Solicitação recusada.");
    }
  } catch (error) {
    console.error(
      "Erro ao processar solicitação:",
      error
    );

    const message =
      error.code === "permission-denied"
        ? "O Firebase bloqueou a operação. Verifique as regras do Firestore."
        : error.message || "Erro inesperado.";

    alert(
      "Não foi possível concluir a ação: " + message
    );
  } finally {
    buttons.forEach(item => {
      item.disabled = false;
    });
  }
});

/* Indicadores do painel. */

function renderStats() {
  const today = todayString();
  const now = Date.now();

  const cancelledStatuses = [
    "cancelled",
    "cancelada",
    "cancelado",
    "recusada",
    "rejected"
  ];

  const activeBookings = bookingsData.filter(item =>
    !cancelledStatuses.includes(
      String(item.status || "").toLowerCase()
    )
  );

  const upcoming = activeBookings.filter(item => {
    const start = meetingStart(item);

    return Number.isFinite(start) && start >= now;
  });

  const todayCount = activeBookings.filter(
    item => item.data === today
  ).length;

  const cancelled = bookingsData.filter(item =>
    cancelledStatuses.includes(
      String(item.status || "").toLowerCase()
    )
  ).length;

  if ($("#statTotal")) {
    $("#statTotal").textContent = bookingsData.length;
  }

  if ($("#statUpcoming")) {
    $("#statUpcoming").textContent = upcoming.length;
  }

  if ($("#statToday")) {
    $("#statToday").textContent = todayCount;
  }

  if ($("#statCancelled")) {
    $("#statCancelled").textContent = cancelled;
  }
}

/* Filtros, pesquisa e tabela de reuniões. */

function renderBookings() {
  const target = $("#confirmed");

  if (!target) return;

  const search = (
    $("#meetingSearch")?.value || ""
  ).trim().toLowerCase();

  const today = todayString();
  const now = Date.now();

  const cancelledStatuses = [
    "cancelled",
    "cancelada",
    "cancelado",
    "recusada",
    "rejected"
  ];

  let filtered = bookingsData.filter(item => {
    const status = String(
      item.status || ""
    ).toLowerCase();

    const cancelled = cancelledStatuses.includes(status);
    const start = meetingStart(item);

    if (
      activeFilter === "upcoming" &&
      (
        cancelled ||
        !Number.isFinite(start) ||
        start < now
      )
    ) {
      return false;
    }

    if (
      activeFilter === "today" &&
      item.data !== today
    ) {
      return false;
    }

    if (
      activeFilter === "cancelled" &&
      !cancelled
    ) {
      return false;
    }

    if (
      activeFilter === "past" &&
      (
        !Number.isFinite(start) ||
        start >= now ||
        cancelled
      )
    ) {
      return false;
    }

    if (search) {
      const text = [
        item.client_name,
        item.nome,
        item.email,
        item.phone,
        item.telefone,
        item.empresa,
        item.subject,
        item.assunto
      ].join(" ").toLowerCase();

      if (!text.includes(search)) return false;
    }

    return true;
  });

  filtered.sort(
    (a, b) => meetingStart(a) - meetingStart(b)
  );

  if (!filtered.length) {
    target.innerHTML = `
      <div class="empty">
        Nenhuma reunião encontrada.
      </div>
    `;

    return;
  }

  target.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Data/hora</th>
          <th>Cliente</th>
          <th>Contato</th>
          <th>Assunto</th>
          <th>Status</th>
          <th>Reunião</th>
        </tr>
      </thead>

      <tbody>
        ${filtered.map(item => {
          const status = item.status || "confirmed";

          const meetUrl =
            item.meetLink ||
            item.meetUrl ||
            item.googleMeetLink ||
            "";

          return `
            <tr>
              <td>
                ${safe(formatDate(item.data, item.horario))}
              </td>

              <td>
                <strong>
                  ${safe(item.client_name || item.nome || "Cliente")}
                </strong>
              </td>

              <td>
                ${safe(item.email || "—")}
              </td>

              <td>
                ${safe(item.subject || item.assunto || "—")}
              </td>

              <td>
                <span class="pill ${statusClass(status)}">
                  ${safe(statusText(status))}
                </span>
              </td>

              <td>
                ${
                  meetUrl
                    ? `
                      <a
                        href="${safe(meetUrl)}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir Meet ↗
                      </a>
                    `
                    : `
                      <span class="muted">
                        Link não disponível
                      </span>
                    `
                }
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

/* Pesquisa de reuniões. */

$("#meetingSearch")?.addEventListener(
  "input",
  renderBookings
);

/* Botões de filtro. */

$("#meetingFilters")?.addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");

  if (!button) return;

  activeFilter = button.dataset.filter;

  $("#meetingFilters")
    ?.querySelectorAll("[data-filter]")
    .forEach(item => {
      item.classList.toggle("active", item === button);
    });

  renderBookings();
});
