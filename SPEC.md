# Fitness Web — specificație

Aplicație de fitness, complet statică (un singur fișier `index.html`, fără server, fără build),
ca să poată fi găzduită gratuit pe GitHub Pages și accesată de pe orice device (telefon inclus).

## Arhitectură

- Un singur fișier `index.html` (HTML + CSS + JS inline), fără framework, fără librării externe.
- Fără server: toată persistența se face în `localStorage` (per-browser, per-device — nu există
  sincronizare automată între telefon și PC, e un compromis acceptat).
- Apelurile către AI (Cerebras + Groq, cu fallback) se fac direct din browser, folosind cheile
  API introduse chiar de fiecare utilizator în pagina de Setări. Cheile stau doar în localStorage-ul
  browserului lui, nu sunt trimise niciodată către vreun server (nu există server) — asta face
  aplicația sigură de distribuit public: fiecare vizitator își pune propria cheie.
- Tema light/dark (day/night), paleta de culori, stilul cardurilor/butoanelor și designul general
  rămân identice cu aplicația originală (Fitness-App).
- Suport PWA (instalabil pe ecranul principal, inclusiv iOS): `manifest.webmanifest`, `icon.svg`
  și `sw.js` (service worker minimal, cache-uiește doar shell-ul static — apelurile către
  Cerebras/Groq merg mereu live, niciodată din cache). Sunt fișiere statice companion, fără build
  step și fără server — nu contrazic regula de mai sus.

## Module (6 taburi)

1. **Home** (fostul Dashboard)
   - Statistici: antrenamente azi, antrenamente luna asta, nutriție azi (calorii/proteine vs
     target), km alergați luna asta (din alergările introduse manual).
   - Silueta corporală (față + spate), SVG desenat manual, stil anatomic natural (nu doar o
     siluetă albă) — evidențiază cu verde grupele musculare lucrate azi, calculate din
     antrenamentele Workout, Easy WOD și Hero WOD finalizate azi.
   - Fără nimic legat de Garmin (s-a scos complet — fără grafic de activități, fără sincronizare).

2. **Workout** (fostul "Antrenament Claudia")
   - Secțiune "Configurare" (echipamente disponibile, skill-uri, schemă săptămânală liberă) —
     stocată în localStorage.
   - Buton mare "🔄 Generează antrenament" → AI generează un antrenament (stil CrossFit/functional,
     adaptat la echipament/skill-uri/schemă) → apare o previzualizare.
   - Poți regenera oricând (nu salvează nimic, doar înlocuiește previzualizarea).
   - Buton "✓ Finalizează antrenamentul" → salvează, clasifică automat (în fundal, fără
     confirmare) ce grupe musculare au fost lucrate, și apare în istoric.
   - Istoric simplu (listă, cu ștergere), la fel ca la Easy WOD / Hero WOD.
   - Contează în statisticile de pe Home și în silueta musculară.
   - Mesaj motivațional random afișat cât timp se generează.

3. **Nutriție**
   - Profil (greutate, înălțime, vârstă, sex, nivel activitate, scop) → calcul target
     calorii/proteine cu formula Mifflin-St Jeor.
   - Adaugă masă: descrii liber ce ai mâncat, un singur buton ("Salvează masa (AI)") care
     analizează cu AI (calorii/proteine/carbohidrați/grăsimi) și salvează direct, fără pas de
     confirmare/validare manuală.
   - Calendar pentru a alege ce zi vizezi (poți loga o masă pentru o zi anterioară).
   - Rezumat zilnic (calorii/proteine consumate vs target) + istoric mese (cu ștergere).

4. **Easy WOD** (fostul "Antrenament ușor")
   - Antrenamente bodyweight, pe saltea, fără echipament (flotări, genoflexiuni, abdomene, plank,
     triceps etc.), format variat de fiecare dată (EMOM, AMRAP, seturi clasice, circuit, tabata),
     15-30 minute total.
   - Același flux: buton mare de generare/regenerare (previzualizare, nu salvează) + buton
     "Finalizează" (salvează + marchează completat + clasifică automat, în fundal, ce grupe
     musculare au fost lucrate — fără pas de confirmare).
   - Istoric simplu (listă, cu ștergere), fără calendar.
   - Contează în statisticile de pe Home și în silueta musculară.

5. **Hero WOD**
   - AI alege un WOD Hero/benchmark REAL și cunoscut din CrossFit (Murph, Fran, Grace, Cindy,
     Diane, Helen, DT, etc.) — nu inventează, prezintă formatul oficial exact (tip: For Time/
     AMRAP/Rounds, repetări și greutăți Rx, time cap, notă vestă/greutăți bărbați vs femei) plus
     1-2 opțiuni de scalare.
   - La regenerare, nu repetă imediat același WOD.
   - Același flux generare/regenerare/Finalizează + clasificare automată de mușchi + istoric
     simplu + contează pe Home/silueta musculară.

6. **Manual** (adăugare manuală)
   - Două moduri, comutabile din pagină: **Antrenament** și **Alergare**.
   - **Antrenament**: câmp text liber, editabil; poți încărca o poză (buton) sau da Paste
     (Ctrl+V) cu o poză — AI (Groq, model vision separat) transcrie antrenamentul din poză și
     îl pune direct în câmpul de text, ca și cum ar fi fost scris manual (rămâne editabil după).
     Buton "✓ Marchează ca finalizat" → salvează, clasifică automat mușchii lucrați (ca la
     Easy/Hero WOD), animație de celebrare, istoric simplu cu ștergere. Contează în
     statisticile de pe Home și în silueta musculară.
   - **Alergare**: câmpuri distanță (km) și pace (min/km), buton de salvare, istoric simplu cu
     ștergere. NU contează în "antrenamente azi/lună" și NU alimentează silueta musculară — are
     propria statistică pe Home ("Km alergați luna asta").

7. **Statistici**
   - Selector de an (implicit anul curent - 5 până la anul curent + 5, ca să acopere și
     antrenamentele planificate în anii viitori).
   - Grafic cu bare: număr de antrenamente pe lună (Workout + Easy WOD + Hero WOD + Manual),
     pentru anul selectat.
   - Grafic cu bare: km alergați pe lună (din modulul Manual → Alergare), pentru anul selectat.
   - Grafice SVG desenate manual, fără librării externe, în aceeași temă light/dark.

## Setări

- Câmpuri pentru cheie API Cerebras + model + model de rezervă, cheie API Groq + model + model
  de rezervă (default-uri sugerate: Cerebras `gpt-oss-120b` / fallback `gemma-4-31b`; Groq
  `llama-3.3-70b-versatile` / fallback `openai/gpt-oss-120b`), plus un model Groq separat pentru
  vision (transcriere poze la modulul Manual, default sugerat `qwen/qwen3.6-27b`).
- Notă vizibilă: cheile rămân doar în browserul tău, nu sunt trimise nicăieri altundeva decât
  direct către Cerebras/Groq.

## Clasificare grupe musculare (pentru Workout, Easy WOD și Hero WOD)

La finalizare, AI clasifică automat (fără intervenția utilizatorului) ce grupe musculare au fost
lucrate, dintr-o listă fixă: chest, back, shoulders, biceps, triceps, forearms, abs, glutes,
quads, hamstrings, calves — împreună cu un nivel de intensitate per mușchi: `high` (mușchi
principal/agonist), `medium` (lucrat semnificativ) sau `low` (stabilizator/secundar). Rezultatul
se salvează pe intrare și alimentează silueta de pe Home cu 3 nuanțe de culoare (ușor/moderat/
intens), agregând nivelul maxim atins per mușchi din toate antrenamentele finalizate azi.

## Ce rămâne neschimbat față de aplicația originală

- Tema light/dark, culorile, stilul cardurilor/butoanelor.
- Randarea markdown a antrenamentelor generate (tabele, liste, titluri) - fără librării externe.
- Mesajele motivaționale afișate în timpul generării.
- Silueta corporală SVG (design anatomic, nu siluetă albă simplă).
