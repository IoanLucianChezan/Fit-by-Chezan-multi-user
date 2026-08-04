# Arhitectura Fit by Chezan (multi-user)

```
Browser (tu / userii)
    ↓ HTTPS
Render (server Node.js, ruleaza server.js non-stop)
    ↓
SQLite (fisier local pe disk, pe serverul Render)
    ↓
Cerebras / Groq (API extern, apelat DOAR de server, niciodata din browser)
```

Totul e server-centric: browserul nu vorbeste niciodata direct cu Cerebras/Groq —
vorbeste doar cu serverul tau, iar serverul vorbeste cu AI-ul.

## Ce ruleaza pe server (Render)

| Fisier | Rol |
|---|---|
| `server.js` | Punctul central — toate rutele HTTP (`/api/auth/*`, `/api/data`, `/api/ai/*`, `/api/admin/*`) |
| `db.js` | Deschide baza SQLite, defineste tabelele, creeaza contul de admin la primul start |
| `auth.js` | Hash parole (bcrypt), semneaza/verifica sesiuni (JWT), middleware `requireAuth`/`requireAdmin` |
| `ai.js` | Logica de apel catre Cerebras (cu fallback pe Groq) — singurul loc din tot proiectul unde cheile AI sunt folosite |
| `public/index.html` | Frontend-ul (tot ce vede userul) |
| `public/admin.html` | Panoul de administrare |

Render porneste `npm start` → `node server.js`, si il tine pornit permanent
(cu o pauza de inactivitate pe planul Free — vezi README.md).

## Unde sunt cheile

Niciodata in cod, niciodata in git. Sunt doar variabile de mediu, setate direct
in dashboard-ul Render (sectiunea Environment):

- `CEREBRAS_API_KEY`, `GROQ_API_KEY` — citite doar de `ai.js`, doar pe server
- `JWT_SECRET` — folosit de `auth.js` ca sa semneze cookie-urile de sesiune
- `ADMIN_PASSWORD` — folosit o singura data, la primul pornit al serverului,
  ca sa creeze contul de admin (dupa aceea parola reala traieste doar
  hash-uita in baza de date)

Local, aceleasi variabile stau in fisierul `.env` din radacina proiectului —
care e in `.gitignore`, deci n-a ajuns niciodata pe GitHub.

## Baza de date (SQLite, un singur fisier `data/app.db` pe server)

Trei tabele:

- **`users`** — username, parola (hash bcrypt, niciodata in clar), rol
  (admin/user), limita AI/zi, activ/inactiv
- **`user_data`** — un blob JSON per user, cu tot ce tinea inainte de
  `localStorage` (antrenamente, nutritie, istoric) — asta e ce sincronizeaza
  browserul prin `GET`/`PUT /api/data`
- **`ai_usage`** — cate cereri AI a facut fiecare user, in fiecare zi (de-aici
  vine si istoricul din panoul admin)

## Fluxul unei cereri AI, pas cu pas

1. Browser → `POST /api/ai/chat` (cu cookie-ul de sesiune, fara nicio cheie)
2. `requireAuth` verifica JWT-ul din cookie → daca nu esti logat, `401`
3. Serverul verifica `ai_usage` — daca ai depasit limita zilnica, `429`
4. Daca esti sub limita: `ai.js` cheama Cerebras (cu cheia din `.env`/Render),
   daca esueaza incearca Groq
5. Serverul incrementeaza contorul din `ai_usage`
6. Raspunsul (fara cheie, fara detalii interne) se intoarce la browser

## Autentificare (JWT in cookie httpOnly)

La login/inregistrare, serverul semneaza un token cu `JWT_SECRET` si il pune
intr-un cookie `httpOnly` (invizibil pentru JavaScript din browser, deci mai
greu de furat prin XSS). La fiecare cerere ulterioara, cookie-ul e trimis
automat de browser, serverul il verifica si identifica userul — fara parola
retrimisa, fara sesiune tinuta in memorie pe server (JWT e "stateless").
