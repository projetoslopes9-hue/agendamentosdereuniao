import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const ADMIN_UID="fatArQtywpak9xoPiS6gPvFSCZx2";
const $=s=>document.querySelector(s);
let auth,db,unsubRequests,unsubBookings;
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
try {
 if(firebaseConfig.apiKey.startsWith("COLE_")||firebaseConfig.projectId.startsWith("COLE_")) throw new Error("Configure firebase-config.js");
 const app=initializeApp(firebaseConfig); auth=getAuth(app); db=getFirestore(app);
} catch(e) { $("#feedback").textContent="Preencha firebase-config.js com os dados do seu projeto."; }

$("#loginForm").addEventListener("submit",async e=>{
 e.preventDefault(); $("#feedback").textContent="";
 try { await signInWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value); }
 catch(err) { $("#feedback").textContent="Não foi possível entrar. Confira e-mail, senha e a configuração do Firebase."; }
});
$("#logout").addEventListener("click",()=>signOut(auth));
onAuthStateChanged(auth,user=>{
 if(unsubRequests)unsubRequests(); if(unsubBookings)unsubBookings();
 const allowed=!!user&&user.uid===ADMIN_UID;
 $("#loginCard").classList.toggle("hidden",allowed); $("#dashboard").classList.toggle("hidden",!allowed); $("#logout").classList.toggle("hidden",!allowed);
 if(user&&!allowed){signOut(auth);$("#feedback").textContent="Esta conta não está autorizada como administradora.";return;}
 if(allowed)loadLists();
});
function loadLists(){
 unsubRequests=onSnapshot(query(collection(db,"solicitacoesPublicas"),orderBy("createdAt","desc")),snap=>{
  $("#requests").innerHTML=snap.empty?'<p class="muted">Nenhuma solicitação recebida.</p>':snap.docs.map(d=>{
   const x=d.data(),id=d.id;
   return `<article class="item"><div class="row"><strong>${safe(x.nome)}</strong><span class="status">${safe(x.status||"pendente")}</span></div><p>${safe(x.email)} · ${safe(x.telefone||"Sem telefone")}</p><p><strong>Data:</strong> ${safe(x.data)} às ${safe(x.horario)}</p><p>${safe(x.assunto||"Sem assunto")}</p>${x.status==="confirmada"?"":`<div class="row"><button data-confirm="${safe(id)}">Confirmar reunião</button><button class="danger" data-reject="${safe(id)}">Recusar</button></div>`}</article>`;
  }).join("");
 });
 unsubBookings=onSnapshot(query(collection(db,"agendamentos"),orderBy("createdAt","desc")),snap=>{
  $("#confirmed").innerHTML=snap.empty?'<p class="muted">Nenhuma reunião confirmada.</p>':snap.docs.map(d=>{const x=d.data();return `<div class="item"><strong>${safe(x.client_name||x.nome)}</strong><p>${safe(x.email||"")} · ${safe(x.data||"")} ${safe(x.horario||"")}</p><span class="muted">Status: ${safe(x.status||"confirmed")}</span></div>`}).join("");
 });
}
$("#requests").addEventListener("click",async e=>{
 const confirmId=e.target.dataset.confirm, rejectId=e.target.dataset.reject;
 try{
  if(confirmId){
   const ref=doc(db,"solicitacoesPublicas",confirmId);
   // A solicitação é convertida em reunião, mas o sistema não cria automaticamente um link do Meet.
   const snapData=await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js").then(async m=>{const s=await m.getDoc(ref);return s.exists()?s.data():null;});
   if(!snapData)throw new Error("Solicitação não encontrada");
   await addDoc(collection(db,"agendamentos"),{client_name:snapData.nome,email:snapData.email,phone:snapData.telefone||"",data:snapData.data,horario:snapData.horario,subject:snapData.assunto||"",status:"confirmed",createdAt:serverTimestamp(),sourceRequestId:confirmId});
   await updateDoc(ref,{status:"confirmada"});
  } else if(rejectId) await updateDoc(doc(db,"solicitacoesPublicas",rejectId),{status:"recusada"});
 }catch(err){console.error(err);alert("Não foi possível concluir a ação. Confira as regras e a conexão do Firebase.");}
});
