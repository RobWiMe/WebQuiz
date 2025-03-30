const bcrypt = require('bcrypt');

const plainPassword = 'Passwort2025!'; // Klartextpasswort

bcrypt.hash(plainPassword, 10, (err, hash) => {
  if (err) {
    console.error('Fehler beim Hashen:', err);
  } else {
    console.log('Gehashter Wert:', hash);
  }
});
