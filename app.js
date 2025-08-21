import express from 'express';
import db from './db.js';
import bodyParser from "body-parser";
import cors from "cors";
import bcrypt from 'bcryptjs';

const app = express();
const port = 5000;

app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

// Servir archivos estáticos (frontend)
app.use(express.static('public'));

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [results] = await db.query(
        `SELECT user_Id, name, last_Name, passwords
        FROM user 
        WHERE email = ?
        LIMIT 1`,
      [email]
    );

    
    if (!results.length) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      //res.json({ success: true, user: results[0] });
    } 
       const user = results[0];
      // ADMIN
      const isAdmin = (email === 'cocodev@sasalele.ejp' && password === 'sal3sal3!');
      if(isAdmin){
      res.json({ 
        success: true, 
        user: user,
        isAdmin: isAdmin
      });
    }else {

      if (!user.passwords.startsWith('$2b$')) {
      // contraseña vieja sin hash
      if (password !== user.passwords) {
        return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
      }
      // re-hash y actualiza en DB
      const newHash = await bcrypt.hash(password, 10);
      await db.query('UPDATE user SET passwords=? WHERE user_Id=?', [newHash, user.user_Id]);
      } else {
      const ok = await bcrypt.compare(password, user.passwords);
      if (!ok) return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
      }

      delete user.passwords;
      res.json({ success: true, user });
    }
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  const { name, lastName, phone, email, age, gender, state, streetAddress, postalCode, city, country, password } = req.body;

  try {
    // Verificar si el usuario ya existe
    const [existingUsers] = await db.query(
      'SELECT user_Id FROM user WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    // Hashear la contraseña antes de guardarla
    const hashed = await bcrypt.hash(password, 10);

    // Insertar nuevo usuario
    const [result] = await db.query(
      `INSERT INTO user (name, last_Name, phone, email, age, gender, state, street_Address, postal_Code, city, country, passwords)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, lastName, phone, email, age, gender, state, streetAddress, postalCode, city, country, hashed]
    );

    res.status(201).json({ 
      success: true, 
      message: 'User created successfully',
      userId: result.insertId 
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, message: 'Database error during signup' });
  }
});

// ✅ Endpoint: devuelve el valor total del portafolio de un usuario
app.get('/api/portfolio/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
      const [rows] = await db.query(`
        SELECT get_portafolio_value(?) AS portfolio_total;
      `, [userId]);

      const total = rows?.[0]?.portfolio_total ?? 0;

      const [gainRows] = await db.query(`
        SELECT get_portafolio_profit(?) AS "Portfolio_Profit";
      `, [userId]);
      const gain = gainRows?.[0]?.Portfolio_Profit ?? 0;

      res.json({ total, gain});
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al calcular el valor del portafolio' });
    }
  });

// 🔹 Historial del portafolio por usuario
app.get('/api/portfolio-history/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'userId inválido' });

  try {
    // CALL devuelve un arreglo de result sets; el primero es el SELECT del SP
    const [resultSets] = await db.query('CALL get_portafolio_history(?);', [userId]);
    const rows = Array.isArray(resultSets) ? resultSets[0] : resultSets;

    // Normalizamos tipos: fecha como string ISO (yyyy-mm-dd) y valor como número
    const data = rows.map(r => ({
      date:
        r.price_Date instanceof Date
          ? r.price_Date.toISOString().slice(0, 10)
          : String(r.price_Date),              // si ya viene como string
      value: Number(r.portafolio_value) || 0
    }));

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el historial' });
  }
});

// 🔹 Acciones actuales del usuario
app.get('/api/current-shares/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'userId inválido' });

  try {
    const [resultSets] = await db.query('CALL get_current_shares(?);', [userId]);
    const rows = Array.isArray(resultSets) ? resultSets[0] : resultSets;

    const data = rows.map(r => ({
      ticker: r.ticker,
      current_shares: Number(r.current_shares) || 0
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo obtener acciones actuales' });
  }
});

// 🔹 Resumen del portafolio del usuario
app.get('/api/portfolio-summary/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'userId inválido' });

  try {
    const [resultSets] = await db.query('CALL get_portafolio_summary(?);', [userId]);
    const rows = Array.isArray(resultSets) ? resultSets[0] : resultSets;

    // Normalizamos claves y nos aseguramos de que los numéricos sean Number
    const data = rows.map(r => ({
      ticker: r.Ticker,
      enterprise: r.Enterprise,
      currentShares: Number(r['Current Shares']) || 0,
      meanCost: Number(r['Mean Cost']) || 0,
      currentPrice: Number(r['Current Price']) || 0,
      marketValue: Number(r['Market Value']) || 0,
      profitLoss: Number(r['Profit Loss']) || 0,
      profitLossPct: Number(r['% Profit Loss']) || 0
    }));

    return res.json({ rows: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'No se pudo obtener el resumen' });
  }
});

app.listen(port, () => {
  console.log(`✅ Server is running on http://localhost:${port}`);
});