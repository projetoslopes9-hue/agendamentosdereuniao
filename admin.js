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
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function timestampValue(value) {
  if (value && typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

function meetingStart(item) {
  if (!item.data) return NaN;
  return new Date(`${item.data}T${item.horario || "00:00"}:00`).getTime();
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
  if (["confirmed", "confirmada", "confirmado"].includes(value)) return "Confirmada";
  if (["cancelled", "cancelada", "cancelado", "recusada"].includes(value)) return "Cancelada";
  if (["pending", "pendente"].includes(value)) return "Pendente";
  return status || "Confirmada";
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (["confirmed", "confirmada", "confirmado"].includes(value)) return "confirmed";
  if (["cancelled", "cancelada", "cancelado", "recusada"].includes(value)) return "cancelled";
  return "pending";
}

/*
 * O HTML novo não tinha mais a área #requests.
 * Criamos essa área automaticamente sem exigir outro admin.html.
 */
function ensureRequestsArea() {
  if ($("#requests")) return;

  const dashboard = $("#dashboard");
  const firstCard = dashboard?.querySelector(".card");
  if (!dashboard || !firstCard) return;

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

function initializeFirebase() {
  if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId) {
    throw new Error("A configuração do Firebase está incompleta.");
  }

  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

try {
  initializeFirebase();
} catch (error) {
  console.error("Erro ao iniciar Firebase:", error);
  showFeedback("Não foi possível iniciar o Firebase. Confira firebase-config.js.");
}

/* Login */

$("#loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  showFeedback("");

  if (!auth) {
    showFeedback("Firebase não está configurado corretamente.");
    return;
  }

  try {
    await signInWithEmailAndPassword(
      auth,
      $("#email").value.trim(),
      $("#password").value
    );
  } catch (error) {
    console.error("Erro no login:", error);
    showFeedback("Não foi possível entrar. Confira o e-mail e a senha.");
  }
});

$("#logout")?.addEventListener("click", async () => {
  if (auth) await signOut(auth);
});

/* Autenticação e autorização */

if (auth) {
  onAuthStateChanged(auth, user => {
    if (unsubRequests) unsubRequests();
    if (unsubBookings) unsubBookings();

    unsubRequests = null;
    unsubBookings = null;

    const allowed = Boolean(user && user.uid === ADMIN_UID);

    $("#loginCard")?.classList.toggle("hidden", allowed);
    $("#dashboard")?.classList.toggle("hidden", !allowed);
    $("#logout")?.classList.toggle("hidden", !allowed);

    if (user && !allowed) {
      showFeedback("Esta conta não está autorizada como administradora.");
      signOut(auth);
      return;
    }

    if (allowed) {
      ensureRequestsArea();
      loadLists();
    }
  });
}

/* Carrega as duas coleções em tempo real */

function loadLists() {
  if (!db) return;

  unsubRequests = onSnapshot(
    query(collection(db, "solicitacoesPublicas"), orderBy("createdAt", "desc")),
    snapshot => {
      requestsData = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      renderRequests();
    },
    error => {
      console.error("Erro ao carregar solicitações:", error);
      const target = $("#requests");
      if (target) {
        target.innerHTML =
          '<p class="muted">Não foi possível carregar as solicitações. Confira as regras do Firestore.</p>';
      }
    }
  );

  unsubBookings = onSnapshot(
    query(collection(db, "agendamentos"), orderBy("createdAt", "desc")),
    snapshot => {
      bookingsData = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      renderBookings();
      renderStats();
    },
    error => {
      console.error("Erro ao carregar agendamentos:", error);
      const target = $("#confirmed");
      if (target) {
        target.innerHTML =
          '<div class="empty">Erro ao carregar reuniões. Confira as permissões do Firestore.</div>';
      }
    }
  );
}

/* Solicitações recebidas */

function renderRequests() {
  const target = $("#requests");
  if (!target) return;

  if (!requestsData.length) {
    target.innerHTML = `
      <div class="empty">
        Nenhuma solicitação recebida.
      </div>`;
    return;
  }

  target.innerHTML = requestsData.map(item => {
    const status = String(item.status || "pendente").toLowerCase();
    const alreadyHandled = ["confirmada", "confirmed", "recusada", "rejected"]
      .includes(status);

    return `
      <article class="item">
        <div class="row">
          <strong>${safe(item.nome || "Cliente")}</strong>
          <span class="pill ${statusClass(status)}">${safe(statusText(status))}</span>
        </div>
        <p>${safe(item.email || "Sem e-mail")} · ${safe(item.telefone || "Sem telefone")}</p>
        <p><strong>Data:</strong> ${safe(formatDate(item.data, item.horario))}</p>
        <p><strong>Assunto:</strong> ${safe(item.assunto || "Sem assunto")}</p>
        ${
          alreadyHandled
            ? ""
            : `<div class="actions">
                <button type="button" data-confirm="${safe(item.id)}">Confirmar reunião</button>
                <button type="button" class="danger" data-reject="${safe(item.id)}">Recusar</button>
              </div>`
        }
      </article>
    `;
  }).join("");
}

$("#requests")?.addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;

  const confirmId = button.dataset.confirm;
  const rejectId = button.dataset.reject;
  if (!confirmId && !rejectId) return;

  button.disabled = true;

  try {
    if (confirmId) {
      const requestRef = doc(db, "solicitacoesPublicas", confirmId);
      const requestSnapshot = await getDoc(requestRef);

      if (!requestSnapshot.exists()) {
        throw new Error("Solicitação não encontrada.");
      }

      const requestData = requestSnapshot.data();

      if (requestData.status !== "pendente") {
        throw new Error("Esta solicitação já foi processada.");
      }

      /*
       * Confirmação manual no Firestore.
       * A criação do evento Google Agenda/Meet depende do backend
       * estar implantado e configurado separadamente.
       */
      await addDoc(collection(db, "agendamentos"), {
        client_name: requestData.nome || "",
        nome: requestData.nome || "",
        email: requestData.email || "",
        phone: requestData.telefone || "",
        data: requestData.data || "",
        horario: requestData.horario || "",
        durationMinutes: 60,
        subject: requestData.assunto || "",
        status: "confirmed",
        createdAt: serverTimestamp(),
        sourceRequestId: confirmId
      });

      await updateDoc(requestRef, { status: "confirmada" });
    }

    if (rejectId) {
      await updateDoc(doc(db, "solicitacoesPublicas", rejectId), {
        status: "recusada"
      });
    }
  } catch (error) {
    console.error("Erro ao processar solicitação:", error);
    alert(
      "Não foi possível concluir a ação. Verifique a conexão, as regras do Firestore e o status da solicitação."
    );
  } finally {
    button.disabled = false;
  }
});

/* Indicadores */

function renderStats() {
  const today = todayString();
  const now = Date.now();

  const activeBookings = bookingsData.filter(item =>
    !["cancelled", "cancelada", "cancelado", "recusada"]
      .includes(String(item.status || "").toLowerCase())
  );

  const upcoming = activeBookings.filter(item => {
    const start = meetingStart(item);
    return Number.isFinite(start) && start >= now;
  });

  const todayCount = activeBookings.filter(item => item.data === today).length;

  const cancelled = bookingsData.filter(item =>
    ["cancelled", "cancelada", "cancelado", "recusada"]
      .includes(String(item.status || "").toLowerCase())
  ).length;

  if ($("#statTotal")) $("#statTotal").textContent = bookingsData.length;
  if ($("#statUpcoming")) $("#statUpcoming").textContent = upcoming.length;
  if ($("#statToday")) $("#statToday").textContent = todayCount;
  if ($("#statCancelled")) $("#statCancelled").textContent = cancelled;
}

/* Filtros, pesquisa e tabela */

function renderBookings() {
  const target = $("#confirmed");
  if (!target) return;

  const search = ($("#meetingSearch")?.value || "").trim().toLowerCase();
  const today = todayString();
  const now = Date.now();

  let filtered = bookingsData.filter(item => {
    const status = String(item.status || "").toLowerCase();
    const cancelled = ["cancelled", "cancelada", "cancelado", "recusada"].includes(status);
    const start = meetingStart(item);

    if (activeFilter === "upcoming" && (cancelled || !Number.isFinite(start) || start < now)) return false;
    if (activeFilter === "today" && item.data !== today) return false;
    if (activeFilter === "cancelled" && !cancelled) return false;
    if (activeFilter === "past" && (!Number.isFinite(start) || start >= now || cancelled)) return false;

    if (search) {
      const text = [
        item.client_name, item.nome, item.email, item.phone,
        item.empresa, item.subject, item.assunto
      ].join(" ").toLowerCase();

      if (!text.includes(search)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => meetingStart(a) - meetingStart(b));

  if (!filtered.length) {
    target.innerHTML = '<div class="empty">Nenhuma reunião encontrada.</div>';
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
          const meetUrl = item.meetLink || item.meetUrl || item.googleMeetLink || "";

          return `
            <tr>
              <td>${safe(formatDate(item.data, item.horario))}</td>
              <td><strong>${safe(item.client_name || item.nome || "Cliente")}</strong></td>
              <td>${safe(item.email || "—")}</td>
              <td>${safe(item.subject || item.assunto || "—")}</td>
              <td><span class="pill ${statusClass(status)}">${safe(statusText(status))}</span></td>
              <td>
                ${
                  meetUrl
                    ? `<a href="${safe(meetUrl)}" target="_blank" rel="noopener noreferrer">Abrir Meet ↗</a>`
                    : '<span class="muted">Link não disponível</span>'
                }
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

$("#meetingSearch")?.addEventListener("input", renderBookings);

$("#meetingFilters")?.addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;

  activeFilter = button.dataset.filter;

  $("#meetingFilters").querySelectorAll("[data-filter]").forEach(item => {
    item.classList.toggle("active", item === button);
  });

  renderBookings();
});
