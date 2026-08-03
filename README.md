# Fit by Chezan — Multi-user

Versiune server a aplicației [Fit by Chezan](../Fitness-Web) (care rămâne neschimbată, static/GitHub Pages).
Aici cheile Cerebras/Groq stau server-side, userii au cont (username/parolă), datele fiecăruia
sunt izolate pe server, iar administratorul poate seta o limită zilnică de cereri AI per user.

## Arhitectură

- **Backend**: Node.js + Express, `server.js`. Baza de date e SQLite via modulul nativ `node:sqlite`
  (Node ≥ 22.5) — fără dependențe native de compilat.
- **Auth**: sesiune JWT în cookie httpOnly (`auth.js`). Parole hash-uite cu bcrypt.
- **AI proxy**: `ai.js` — aceeași logică de fallback Cerebras → Groq care exista înainte în browser,
  mutată server-side. Cheile stau doar în `.env`, niciodată trimise către client.
- **Date per user**: `user_data` (un blob JSON per user, aceleași chei ca vechiul `localStorage`)
  — frontend-ul (`public/index.html`) sincronizează automat cu `GET`/`PUT /api/data`.
- **Limită AI**: tabelul `ai_usage` ține un contor per user/zi. Depășirea limitei → `429` cu mesaj clar.
- **Admin**: `public/admin.html` — creează useri, setează limita zilnică, dezactivează/șterge conturi.
  Primul cont admin se creează automat la primul start, din `ADMIN_USERNAME`/`ADMIN_PASSWORD` din `.env`.

## Instalare

```bash
npm install
cp .env.example .env
```

Completează `.env`:

| Variabilă | Descriere |
|---|---|
| `JWT_SECRET` | Secret pentru semnarea sesiunilor. Generează: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Contul de admin, creat automat la primul start |
| `CEREBRAS_API_KEY` / `GROQ_API_KEY` | Cheile AI, server-side |
| `PORT` | Portul serverului (implicit 3000) |

## Rulare

```bash
npm start        # producție
npm run dev       # cu auto-reload (node --watch)
```

Aplicația: `http://localhost:3000`
Panou admin: `http://localhost:3000/admin.html`

## Deploy

GitHub Pages **nu merge** aici (are nevoie de server care rulează, nu doar fișiere statice).
Railway sau Render sunt cele mai simple — deploy direct din repo git, plan gratuit/hobby suficient
la trafic mic, HTTPS automat. Setează aceleași variabile de mediu din `.env` în platforma aleasă.

## Structură

```
server.js       - rute Express (auth, date, AI proxy, admin)
db.js           - schema SQLite + seed admin
auth.js         - JWT, bcrypt, middleware requireAuth/requireAdmin
ai.js           - fallback Cerebras -> Groq, server-side
public/
  index.html    - aplicația (fostul Fit by Chezan, cu login gate + sync server)
  admin.html    - panou administrare useri
data/           - app.db (SQLite, exclus din git)
```
