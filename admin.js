
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
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

import { firebaseConfig } from "./firebase-config.js";

const ADMIN_UID = "fatArQtywpak9xoPiS6gPvFSCZx2";
const $ = selector => document.querySelector(selector);

let auth;
let db;
let functions;
let confirmarReuniao;

let unsubRequests;
let unsubBookings;

const safe = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

function showFeedback(message, isError = true) {
  const feedback = $("#feedback");

  if (!feedback) {
    alert(message);
    return;
  }

  feedback.textContent = message;
  feedback.style.color = isError ? "#b91c1c" : "#047857";
}

function setButtonLoading(button, loading, originalText) {
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading ? "Processando..." : originalText;
}

try {
  if (
    !firebaseConfig?.apiKey ||
    !firebaseConfig?.projectId ||
    firebaseConfig.apiKey.startsWith("COLE_") ||
    firebaseConfig.projectId.startsWith("COLE_")
  ) {
    throw new Error("Configure firebase-config.js");
  }

  const app = initializeApp(firebaseConfig);

  auth = getAuth(app);
  db = getFirestore(app);

  functions = getFunctions(app, "southamerica-east1");

  confirmarReuniao = httpsCallable(
    functions,
    "confirmarReuniao"
  );
} catch (error) {
  console.error("Erro ao inicializar Firebase:", error);

  showFeedback(
    "Não foi possível inicializar o Firebase. Confira firebase-config.js."
  );
}

// Login administrativo
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!auth) {
    showFeedback("O Firebase não foi inicializado corretamente.");
    return;
  }

  showFeedback("");

  const email = $("#email").value.trim();
  const password = $("#password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error("Erro no login:", error);

    showFeedback(
      "Não foi possível entrar. Confira o e-mail, a senha e a configuração do Firebase."
    );
  }
});

// Logout
$("#logout").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Erro ao sair:", error);
    showFeedback("Não foi possível encerrar a sessão.");
  }
});

// Verifica a identidade do administrador
if (auth) {
  onAuthStateChanged(auth, user => {
    if (unsubRequests) unsubRequests();
    if (unsubBookings) unsubBookings();

    unsubRequests = null;
    unsubBookings = null;

    const allowed = Boolean(user && user.uid === ADMIN_UID);

    $("#loginCard").classList.toggle("hidden", allowed);
    $("#dashboard").classList.toggle("hidden", !allowed);
    $("#logout").classList.toggle("hidden", !allowed);

    if (user && !allowed) {
      showFeedback(
        "Esta conta não está autorizada como administradora."
      );

      signOut(auth).catch(console.error);
      return;
    }

    if (allowed) {
      loadLists();
    }
  });
}

// Carrega solicitações e reuniões em tempo real
function loadLists() {
  unsubRequests = onSnapshot(
    query(
      collection(db, "solicitacoesPublicas"),
      orderBy("createdAt", "desc")
    ),
    snapshot => {
      const requests = $("#requests");

      if (snapshot.empty) {
        requests.innerHTML =
          '<p class="muted">Nenhuma solicitação recebida.</p>';
        return;
      }

      requests.innerHTML = snapshot.docs.map(document => {
        const data = document.data();
        const id = document.id;
        const status = data.status || "pendente";

        const actions = status === "pendente"
          ? `
            <div class="row">
              <button data-confirm="${safe(id)}">
                Confirmar reunião
              </button>
              <button class="danger" data-reject="${safe(id)}">
                Recusar
              </button>
            </div>
          `
          : "";

        return `
          <article class="item">
            <div class="row">
              <strong>${safe(data.nome)}</strong>
              <span class="status">${safe(status)}</span>
            </div>

            <p>
              ${safe(data.email)}
              · ${safe(data.telefone || "Sem telefone")}
            </p>

            <p>
              <strong>Data:</strong>
              ${safe(data.data)} às ${safe(data.horario)}
            </p>

            <p>${safe(data.assunto || "Sem assunto")}</p>

            ${data.meetLink ? `
              <p>
                <a href="${safe(data.meetLink)}"
                   target="_blank"
                   rel="noopener noreferrer">
                  Abrir Google Meet
                </a>
              </p>
            ` : ""}

            ${actions}
          </article>
        `;
      }).join("");
    },
    error => {
      console.error("Erro ao carregar solicitações:", error);

      $("#requests").innerHTML =
        '<p class="muted">Não foi possível carregar as solicitações. Verifique as permissões do Firestore.</p>';
    }
  );

  unsubBookings = onSnapshot(
    query(
      collection(db, "agendamentos"),
      orderBy("createdAt", "desc")
    ),
    snapshot => {
      const confirmed = $("#confirmed");

      if (snapshot.empty) {
        confirmed.innerHTML =
          '<p class="muted">Nenhuma reunião confirmada.</p>';
        return;
      }

      confirmed.innerHTML = snapshot.docs.map(document => {
        const data = document.data();

        return `
          <article class="item">
            <strong>
              ${safe(data.client_name || data.nome)}
            </strong>

            <p>
              ${safe(data.email || "")}
              · ${safe(data.data || "")}
              às ${safe(data.horario || "")}
            </p>

            <p>
              <strong>Duração:</strong>
              ${safe(data.durationMinutes || 60)} minutos
            </p>

            <p>
              <span class="muted">
                Status: ${safe(data.status || "confirmed")}
              </span>
            </p>

            ${data.meetLink ? `
              <p>
                <a href="${safe(data.meetLink)}"
                   target="_blank"
                   rel="noopener noreferrer">
                  Entrar na reunião pelo Google Meet
                </a>
              </p>
            ` : `
              <p class="muted">
                Link do Meet ainda não disponível.
              </p>
            `}
          </article>
        `;
      }).join("");
    },
    error => {
      console.error("Erro ao carregar reuniões:", error);

      $("#confirmed").innerHTML =
        '<p class="muted">Não foi possível carregar as reuniões.</p>';
    }
  );
}

// Confirmação manual e recusa de solicitações
$("#requests").addEventListener("click", async event => {
  const button = event.target.closest("button");

  if (!button) return;

  const confirmId = button.dataset.confirm;
  const rejectId = button.dataset.reject;

  if (!confirmId && !rejectId) return;

  if (!auth.currentUser || auth.currentUser.uid !== ADMIN_UID) {
    showFeedback("Você não está autorizado a executar esta ação.");
    return;
  }

  if (confirmId) {
    const approved = confirm(
      "Deseja confirmar esta reunião?\n\n" +
      "O sistema verificará a disponibilidade no Google Agenda e " +
      "tentará criar um evento de 60 minutos com link do Google Meet."
    );

    if (!approved) return;

    setButtonLoading(button, true, "Confirmar reunião");

    try {
      const result = await confirmarReuniao({
        requestId: confirmId
      });

      const data = result.data || {};

      if (data.meetLink) {
        alert(
          "Reunião confirmada!\n\n" +
          "Duração: 60 minutos\n\n" +
          "Link do Google Meet:\n" +
          data.meetLink
        );
      } else {
        alert(
          data.message ||
          "A função retornou sem um link do Meet. Confira o estado da reunião antes de tentar novamente."
        );
      }
    } catch (error) {
      console.error("Erro ao confirmar reunião:", error);

      const messages = {
        "permission-denied":
          "Sua conta não tem permissão para confirmar esta reunião.",
        "not-found":
          "A solicitação não foi encontrada.",
        "already-exists":
          "Este horário já está reservado por outra confirmação.",
        "failed-precondition":
          "Não foi possível confirmar. A solicitação pode não estar pendente ou o horário pode estar ocupado.",
        "unauthenticated":
          "Sua sessão expirou. Entre novamente no painel."
      };

      alert(
        messages[error.code] ||
        "Não foi possível confirmar a reunião. Verifique a função Firebase, a integração Google e os registros de erro."
      );
    } finally {
      setButtonLoading(button, false, "Confirmar reunião");
    }

    return;
  }

  if (rejectId) {
    const approved = confirm(
      "Tem certeza de que deseja recusar esta solicitação?"
    );

    if (!approved) return;

    setButtonLoading(button, true, "Recusar");

    try {
      await updateDoc(
        doc(db, "solicitacoesPublicas", rejectId),
        { status: "recusada" }
      );
    } catch (error) {
      console.error("Erro ao recusar solicitação:", error);

      alert(
        "Não foi possível recusar a solicitação. Confira sua conexão e as permissões do Firestore."
      );
    } finally {
      setButtonLoading(button, false, "Recusar");
    }
  }
});
