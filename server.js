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
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
});
