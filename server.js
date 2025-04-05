// === GRUNDKONFIGURATION ===
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Für Form-Daten (Admin-Login)

app.use(session({
  secret: process.env.ADMIN_SECRET || 'fallbackSessionSecret',
  resave: false,
  saveUninitialized: false,
}));

// === POSTGRES EINRICHTUNG ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === TESTROUTE: BACKEND ONLINE ===
app.get('/', (req, res) => {
  res.send('Webquiz Backend ist online');
});

// === REGISTRIERUNG ===
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hashed]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'E-Mail bereits registriert' });
    } else {
      console.error('Fehler bei Registrierung:', err);
      res.status(500).json({ error: 'Serverfehler' });
    }
  }
});

// === LOGIN ===
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Benutzer nicht gefunden' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Falsches Passwort' });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ token });
  } catch (err) {
    console.error('Login-Fehler:', err);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// === FRAGEN ABRUFEN ===
app.get('/questions', async (req, res) => {
  const category = req.query.category;
  if (!category) return res.status(400).json({ error: 'Kategorie-ID fehlt (?category=ID)' });

  try {
    const result = await pool.query(
      'SELECT * FROM questions WHERE category_id = $1 ORDER BY RANDOM() LIMIT 10',
      [category]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fragenfehler:', err);
    res.status(500).json({ error: 'Serverfehler beim Laden der Fragen' });
  }
});

// === KATEGORIEN ABRUFEN ===
app.get('/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Kategorien-Fehler:', err);
    res.status(500).json({ error: 'Kategorien konnten nicht geladen werden' });
  }
});

// === HIGHSCORE SPEICHERN ===
app.post('/highscores', async (req, res) => {
  const { user_id, guest_name, score, mode } = req.body;
  if (!score || !mode || (!user_id && !guest_name)) {
    return res.status(400).json({ error: 'Fehlende Angaben: score, mode, user_id/guest_name' });
  }

  try {
    await pool.query(
      'INSERT INTO highscores (user_id, guest_name, score, mode) VALUES ($1, $2, $3, $4)',
      [user_id || null, guest_name || null, score, mode]
    );
    res.status(201).json({ message: 'Highscore gespeichert' });
  } catch (err) {
    console.error('Highscore-Fehler:', err);
    res.status(500).json({ error: 'Serverfehler beim Speichern' });
  }
});

// === HIGHSCORE ABRUFEN ===
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
    res.status(500).json({ error: 'Serverfehler beim Abrufen' });
  }
});

// === FRAGEN-ERKLÄRUNG LADEN ===
app.get('/explanation/:question_id', async (req, res) => {
  const id = req.params.question_id;
  try {
    const result = await pool.query(
      'SELECT explanation FROM questions WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Frage nicht gefunden' });

    res.json({ question_id: id, explanation: result.rows[0].explanation });
  } catch (err) {
    console.error('Fehler bei Erklärung:', err);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// === FRAGE EINREICHEN ===
app.post('/submitted-questions', async (req, res) => {
  const {
    user_email, category_id, question,
    option_a, option_b, option_c, option_d,
    correct_option, explanation
  } = req.body;

  if (!category_id || !question || !option_a || !option_b || !option_c || !option_d || !correct_option) {
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  }

  try {
    await pool.query(`
      INSERT INTO submitted_questions 
      (user_email, category_id, question, option_a, option_b, option_c, option_d, correct_option, explanation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      user_email || null,
      category_id, question,
      option_a, option_b, option_c, option_d,
      correct_option,
      explanation || null
    ]);
    res.status(201).json({ message: 'Frage eingereicht' });
  } catch (err) {
    console.error('Einreich-Fehler:', err);
    res.status(500).json({ error: 'Serverfehler beim Einreichen' });
  }
});

// === ADMIN: EINREICHUNGEN LISTEN ===
app.get('/submitted-questions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM submitted_questions WHERE reviewed = FALSE ORDER BY submitted_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fehler beim Abrufen eingereichter Fragen:', err);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// === ADMIN: FRAGE GENEHMIGEN ===
app.post('/approve-question/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query('SELECT * FROM submitted_questions WHERE id = $1', [id]);
    const q = result.rows[0];
    if (!q) return res.status(404).json({ error: 'Nicht gefunden' });

    await pool.query(`
      INSERT INTO questions (category_id, question, option_a, option_b, option_c, option_d, correct_option, explanation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [
      q.category_id, q.question,
      q.option_a, q.option_b, q.option_c, q.option_d,
      q.correct_option, q.explanation
    ]);

    await pool.query('UPDATE submitted_questions SET reviewed = TRUE WHERE id = $1', [id]);

    res.json({ message: 'Frage genehmigt und übernommen' });
  } catch (err) {
    console.error('Freigabe-Fehler:', err);
    res.status(500).json({ error: 'Serverfehler bei Genehmigung' });
  }
});

// === ADMIN: EINREICHUNG LÖSCHEN ===
app.delete('/delete-submitted/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await pool.query('DELETE FROM submitted_questions WHERE id = $1', [id]);
    res.json({ message: 'Einreichung gelöscht' });
  } catch (err) {
    console.error('Löschfehler:', err);
    res.status(500).json({ error: 'Serverfehler beim Löschen' });
  }
});

// === ADMIN LOGIN / SCHUTZ ===
app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.post('/admin-login', (req, res) => {
  const input = req.body.password;
  const real = process.env.ADMIN_PASSWORD || 'admin123';

  if (input === real) {
    req.session.admin = true;
    return res.redirect('/admin');
  }
  res.status(401).send('Falsches Passwort');
});

app.get('/admin', (req, res) => {
  if (!req.session.admin) {
    return res.redirect('/admin-login');
  }
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// === SERVER STARTEN ===
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});
