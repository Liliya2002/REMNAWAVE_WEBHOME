const bcrypt = require('bcryptjs');
const db = require('./db.js');

(async () => {
    try {
        const hash = await bcrypt.hash('12345678Aa', 10);
        const query = 'INSERT INTO users (login, email, password_hash, email_confirmed) VALUES ($1, $2, $3, $4)';
        await db.query(query, ['testuser', 'demo@vpn.2026', hash, true]);
        console.log('Пользователь успешно создан! Email: demo@vpn.2026, Пароль: 12345678Aa');
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
})();
