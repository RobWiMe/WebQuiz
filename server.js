// === SERVER.JS ===
// Status: Registrierung, Login, Fragenabruf nach Kategorie, Kategorienliste

// === 1. GRUNDKONFIGURATION ===
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// === 2. POSTGRESQL EINRICHTEN ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === 3. ROUTE: SERVER-CHECK ===
// FRONTEND: Kann genutzt werden, um zu prüfen, ob das Backend läuft
app.get('/', (req, res) => {
  res.send('Webquiz Backend ist online');
});

// === 4. ROUTE: REGISTRIERUNG ===
// FRONTEND: POST /register
// Erwartet im Body: { email, password }
// Gibt zurück: { user: { id, email } }
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hashedPassword]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error('Fehler bei Registrierung:', err);
    if (err.code === '23505') {
      res.status(400).json({ error: 'E-Mail bereits registriert' });
    } else {
      res.status(500).json({ error: 'Serverfehler' });
    }
  }
});

// === 5. ROUTE: LOGIN ===
// FRONTEND: POST /login
// Erwartet im Body: { email, password }
// Gibt zurück: { token } (wird im Frontend gespeichert)
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Falsches Passwort' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ token });
  } catch (err) {
    console.error('Fehler beim Login:', err);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// === 6. ROUTE: FRAGEN ABRUFEN (NACH KATEGORIE) ===
// FRONTEND: GET /questions?category=ID
// Erwartet: query parameter category (z. B. category=2)
// Gibt zurück: Array mit max. 10 zufälligen Fragen aus dieser Kategorie
app.get('/questions', async (req, res) => {
  const category = req.query.category;
  if (!category) {
    return res.status(400).json({ error: 'Kategorie-ID fehlt. Verwende ?category=ID' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM questions WHERE category_id = $1 ORDER BY RANDOM() LIMIT 10',
      [category]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fehler beim Abrufen der Fragen:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// === 7. ROUTE: KATEGORIEN ABRUFEN ===
// FRONTEND: GET /categories
// Erwartet keine Parameter
// Gibt zurück: Array mit allen verfügbaren Kategorien (id + name)
// Beispiel: [ { id: 1, name: "Programmierung" }, ... ]
app.get('/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Fehler beim Abrufen der Kategorien:', err);
    res.status(500).json({ error: 'Kategorien konnten nicht geladen werden' });
  }
});

// === 8. SERVER STARTEN ===
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

// === 9. HIGHSCORE SPEICHERN ===
// FRONTEND: POST /highscores
// Erwartet im Body: { user_id, score, mode }
// Beispiel-Request:
// { "user_id": 1, "score": 700, "mode": "solo" }
app.post('/highscores', async (req, res) => {
  const { user_id, guest_name, score, mode } = req.body;

  // Prüfen, ob die erforderlichen Felder vorhanden sind
  if (!score || !mode || (!user_id && !guest_name)) {
    return res.status(400).json({ error: 'Fehlende Angaben: score, mode und entweder user_id oder guest_name' });
  }

  try {
    await pool.query(
      'INSERT INTO highscores (user_id, guest_name, score, mode) VALUES ($1, $2, $3, $4)',
      [user_id || null, guest_name || null, score, mode]
    );
    res.status(201).json({ message: 'Highscore gespeichert' });
  } catch (err) {
    console.error('Fehler beim Speichern des Highscores:', err);
    res.status(500).json({ error: 'Serverfehler beim Speichern des Highscores' });
  }
});

// === 10. HIGHSCORES LADEN ===
// FRONTEND: GET /highscores
// Gibt eine Liste zurück (Top 10), inkl. Nutzer-E-Mail und Modus
app.get('/highscores', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COALESCE(u.email, h.guest_name) AS name,
        h.score,
        h.mode,
        h.created_at
      FROM highscores h
      LEFT JOIN users u ON h.user_id = u.id
      ORDER BY h.score DESC, h.created_at ASC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Fehler beim Laden der Highscores:', err);
    res.status(500).json({ error: 'Serverfehler beim Abrufen der Highscores' });
  }
});

// Erklärung zur Frage anhand der Frage-ID abrufen
app.get('/explanation/:question_id', async (req, res) => {
  const questionId = req.params.question_id;

  try {
    const result = await pool.query(
      'SELECT explanation FROM questions WHERE id = $1',
      [questionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Frage nicht gefunden' });
    }

    res.json({
      question_id: questionId,
      explanation: result.rows[0].explanation
    });

  } catch (err) {
    console.error('Fehler beim Abrufen der Erklärung:', err);
    res.status(500).json({ error: 'Serverfehler beim Abrufen der Erklärung' });
  }
});

// === ROUTE: Nutzer kann neue Frage einreichen ===
// Diese Frage wird NICHT direkt ins Quiz übernommen, sondern in die Tabelle 'submitted_questions' geschrieben
// Sie wartet dort auf Freigabe durch einen Admin (oder euch als Projektteam)

app.post('/submit-question', async (req, res) => {
  // Hole alle notwendigen Felder aus dem Anfrage-Body
  const {
    user_email,       // optional: falls eingeloggter Nutzer (kann auch null sein)
    category_id,      // ID der Kategorie, z. B. 1 = Aussagenlogik, 2 = Requirements etc.
    question,         // Die eigentliche Frage
    option_a,         // Antwortmöglichkeit A
    option_b,         // Antwortmöglichkeit B
    option_c,         // Antwortmöglichkeit C
    option_d,         // Antwortmöglichkeit D
    correct_option,   // Richtige Antwort (nur A, B, C oder D erlaubt)
    explanation       // Erklärung zur richtigen Antwort (optional)
  } = req.body;

  // === VALIDIERUNG ===
  // Überprüfe, ob alle Pflichtfelder ausgefüllt sind
  if (!category_id || !question || !option_a || !option_b || !option_c || !option_d || !correct_option) {
    return res.status(400).json({ error: 'Bitte alle Pflichtfelder ausfüllen.' });
  }

  try {
    // === DATENBANKEINTRAG ===
    // Speichere die eingereichte Frage in der Tabelle submitted_questions
    await pool.query(
      `INSERT INTO submitted_questions 
       (user_email, category_id, question, option_a, option_b, option_c, option_d, correct_option, explanation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        user_email || null,        // falls leer, NULL speichern
        category_id,
        question,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_option,
        explanation || null        // falls leer, NULL speichern
      ]
    );

    // === ERFOLGSNACHRICHT ===
    res.status(201).json({ message: 'Frage wurde eingereicht und wartet auf Prüfung.' });

  } catch (err) {
    // === FEHLERBEHANDLUNG ===
    console.error('Fehler beim Speichern der Einreichung:', err);
    res.status(500).json({ error: 'Serverfehler beim Einreichen der Frage' });
  }
});
