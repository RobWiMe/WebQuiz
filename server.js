// === SERVER.JS – WebQuiz Backend ===

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// === GRUNDKONFIGURATION ===
const app = express();
app.use(cors());
app.use(express.json());

// === POSTGRESQL EINRICHTUNG ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === SERVER-CHECK ===
app.get('/', (req, res) => {
  res.send('Webquiz Backend ist online');
});

// === REGISTRIERUNG ===
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

// === LOGIN ===
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

// === FRAGEN ABRUFEN (nach Kategorie) ===
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

// === KATEGORIEN ABRUFEN ===
app.get('/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Fehler beim Abrufen der Kategorien:', err);
    res.status(500).json({ error: 'Kategorien konnten nicht geladen werden' });
  }
});

// === HIGHSCORE SPEICHERN ===
app.post('/highscores', async (req, res) => {
  const { user_id, guest_name, score, mode } = req.body;

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

// === HIGHSCORES ABRUFEN ===
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

// === ERKLÄRUNG ZU EINER FRAGE ABRUFEN ===
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

// === FRAGE EINREICHEN ===
app.post('/submitted-questions', async (req, res) => {
  const {
    user_email,
    category_id,
    question,
    option_a,
    option_b,
    option_c,
    option_d,
    correct_option,
    explanation
  } = req.body;

  if (!category_id || !question || !option_a || !option_b || !option_c || !option_d || !correct_option) {
    return res.status(400).json({ error: 'Bitte alle Pflichtfelder ausfüllen.' });
  }

  try {
    await pool.query(
      `INSERT INTO submitted_questions 
       (user_email, category_id, question, option_a, option_b, option_c, option_d, correct_option, explanation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        user_email || null,
        category_id,
        question,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_option,
        explanation || null
      ]
    );

    res.status(201).json({ message: 'Frage wurde eingereicht und wartet auf Prüfung.' });

  } catch (err) {
    console.error('Fehler beim Speichern der Einreichung:', err);
    res.status(500).json({ error: 'Serverfehler beim Einreichen der Frage' });
  }
});

// === EINREICHUNGEN ABRUFEN (für Admin) ===
app.get('/submitted-questions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM submitted_questions WHERE reviewed = FALSE ORDER BY submitted_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Fehler beim Laden eingereichter Fragen:', err);
    res.status(500).json({ error: 'Serverfehler beim Abrufen der Einreichungen' });
  }
});

// === FRAGE GENEHMIGEN UND ÜBERNEHMEN (Admin) ===
app.post('/approve-question/:id', async (req, res) => {
  const questionId = req.params.id;

  try {
    const result = await pool.query('SELECT * FROM submitted_questions WHERE id = $1', [questionId]);
    const question = result.rows[0];

    if (!question) {
      return res.status(404).json({ error: 'Einreichung nicht gefunden' });
    }

    await pool.query(
      `INSERT INTO questions (category_id, question, option_a, option_b, option_c, option_d, correct_option, explanation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        question.category_id,
        question.question,
        question.option_a,
        question.option_b,
        question.option_c,
        question.option_d,
        question.correct_option,
        question.explanation
      ]
    );

    await pool.query('UPDATE submitted_questions SET reviewed = TRUE WHERE id = $1', [questionId]);

    res.json({ message: 'Frage genehmigt und übernommen' });
  } catch (err) {
    console.error('Fehler bei der Freigabe:', err);
    res.status(500).json({ error: 'Serverfehler bei der Genehmigung' });
  }
});

// === EINREICHUNG LÖSCHEN (Admin) ===
app.delete('/delete-submitted/:id', async (req, res) => {
  const questionId = req.params.id;

  try {
    await pool.query('DELETE FROM submitted_questions WHERE id = $1', [questionId]);
    res.json({ message: 'Einreichung gelöscht' });
  } catch (err) {
    console.error('Fehler beim Löschen:', err);
    res.status(500).json({ error: 'Serverfehler beim Löschen der Einreichung' });
  }
});

// === SERVER STARTEN ===
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});
