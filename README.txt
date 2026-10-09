AGENDAMENTO - FIREBASE (HTML/CSS/JavaScript)

ARQUIVOS
- index.html / public.js: formulário público para clientes solicitarem horário.
- admin.html / admin.js: painel básico para entrar, ver solicitações, confirmar ou recusar.
- firebase-config.js: configuração do app Web (você precisa preencher).
- firestore.rules: regras de segurança para publicar no Firestore.

1. CONFIGURAR O FIREBASE
No Firebase Console > Configurações do projeto > Geral > Seus apps > app Web,
copie a configuração do SDK e preencha firebase-config.js.
Não cole aqui senha de usuário, chave privada de service account ou credenciais de servidor.
A apiKey do Firebase Web é identificador do projeto, não é uma senha; a segurança depende das regras.

2. ADMINISTRADOR
O painel está autorizado ao UID que você informou. Confirme que o usuário cadastrado no
Firebase Authentication tem exatamente esse UID. Para trocar, edite ADMIN_UID em admin.js
e o UID nas regras Firestore, mantendo ambos iguais.

3. REGRAS
No Firestore Database > Regras, revise e publique o conteúdo de firestore.rules.
Isso mantém as solicitações públicas sem leitura pública. As regras não bloqueiam spam
por completo e não garantem que o horário esteja disponível.

4. EXECUTAR
Como os arquivos usam módulos JavaScript, não abra os HTML com file://.
Publique em Firebase Hosting ou execute um servidor local. Exemplo com Firebase CLI:
- Instale Node.js e Firebase CLI.
- firebase login
- firebase init hosting (selecione o projeto já criado; public directory: .; configure as single-page app: No)
- firebase deploy --only hosting

5. LIMITAÇÕES IMPORTANTES
- Esta versão recebe solicitações e permite confirmá-las no painel.
- Ela NÃO cria automaticamente link Google Meet, não sincroniza Google Agenda e não envia e-mail.
  Para isso, é necessário configurar OAuth/Google Calendar API e uma função de servidor (Cloud Functions)
  com segredos protegidos.
- A confirmação no painel cria um registro, mas ainda não faz verificação transacional de conflitos.
  Antes de usar em produção, implemente reserva atômica de horários no backend e proteção contra spam.
- O HTML administrativo anterior enviado pelo usuário tem recursos extras (filtros, backup, disponibilidade,
  bloqueios, equipe e histórico). Este painel é uma base funcional conectada ao Firebase, não uma migração
  completa de todos esses recursos antigos.
