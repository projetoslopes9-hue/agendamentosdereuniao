import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const form = document.querySelector("#bookingForm");
const button = document.querySelector("#submitBtn");
const message = document.querySelector("#message");
const dateInput = document.querySelector("#data");
dateInput.min = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
function show(text, ok=false) { message.textContent=text; message.className="msg "+(ok?"ok":"err"); message.style.display="block"; }
let db;
try {
  if (firebaseConfig.apiKey.startsWith("COLE_") || firebaseConfig.projectId.startsWith("COLE_")) throw new Error("Configure firebase-config.js");
  const app=initializeApp(firebaseConfig); db=getFirestore(app);
} catch(e) { show("O site ainda precisa ser configurado com os dados do seu projeto Firebase."); }

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return;
  const nome=form.nome.value.trim(), email=form.email.value.trim().toLowerCase();
  const data=form.data.value, horario=form.horario.value;
  if (!nome || !email || !data || !horario) return show("Preencha os campos obrigatórios.");
  if (data < dateInput.min) return show("Escolha uma data futura.");
  button.disabled=true; button.textContent="Enviando...";
  try {
    await addDoc(collection(db,"solicitacoesPublicas"), {
      nome, email, telefone:form.telefone.value.trim(),
      data, horario, assunto:form.assunto.value.trim(),
      status:"pendente", createdAt:serverTimestamp()
    });
    form.reset(); dateInput.min=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
    show("Solicitação enviada! Aguarde a confirmação do administrador.", true);
  } catch(error) {
    console.error(error);
    show("Não foi possível enviar. Verifique a configuração e as regras do Firebase e tente novamente.");
  } finally { button.disabled=false; button.textContent="Enviar solicitação"; }
});
