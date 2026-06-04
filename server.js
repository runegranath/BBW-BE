require("./install.js");
require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt"); // Hasha lösenord
const cors = require("cors");

// Express
const app = express();
app.use(express.json()); // För att kunna läsa av JSON-data i body
const jwt = require("jsonwebtoken"); // JSON Web Token (JWT)

// Aktivera CORS (Cross-Origin Resource Sharing) för att tillåta frontend att kommunicera med backend
app.use(cors());

// SQLite-anslutning via Turso för att datan inte ska rensas
const { createClient } = require("@libsql/client");

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// hasha lösenordet före synkront
bcrypt
  .hash("adminadmin123", 10)
  .then(async (hashedPassword) => {
    const adminEmail = "admin@admin.com";
    try {
      const result = await db.execute({
        sql: "SELECT * FROM users WHERE email = ?",
        args: [adminEmail],
      });

      if (result.rows.length === 0) {
        await db.execute({
          sql: "INSERT INTO users (email, password) VALUES (?, ?)",
          args: [adminEmail, hashedPassword],
        });
        console.log(`Auto-skapat adminkonto: ${adminEmail}`);
      }
    } catch (err) {
      console.error("Fel vid skapande av admin:", err.message);
    }
  })
  .catch((err) => console.error(err));

// Routes
app.get("/api", (req, res) => {
  res.json({ message: "Välkommen till API:et!" });
});

// Skyddad route som kräver JWT-token
app.get("/api/protected", authenticateToken, (req, res) => {
  res.json({ message: "Skyddad route!" });
});

// Route för att skapa en beställning (kräver ej JWT)
app.post("/api/orders", async (req, res) => {
  // Hämta data från request body för att skapa beställningen
  const { dish_id, customer_name, customer_phone, pickup_time, quantity } =
    req.body;

  // Validering: Kontrollerar ifyllda fält
  if (!dish_id || !customer_name || !customer_phone || !pickup_time) {
    return res.status(400).json({ error: "Alla fält måste vara ifyllda." });
  }

  const sql = `
        INSERT INTO orders (dish_id, customer_name, customer_phone, pickup_time, quantity)
        VALUES (?, ?, ?, ?, ?)
    `;

  // 1 sätts som default och är valfritt att skicka med
  const params = [
    dish_id,
    customer_name,
    customer_phone,
    pickup_time,
    quantity || 1,
  ];

  try {
    const result = await db.execute({ sql, args: params });
    res.status(201).json({
      message: "Beställning mottagen!",
      // lastInsertRowid istället för this.lastID här med Turso
      orderId: result.lastInsertRowid
        ? result.lastInsertRowid.toString()
        : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Något gick fel" });
  }
});

// Route för att hämta alla beställningar till ordersidan (kräver JWT)
app.get("/api/orders", authenticateToken, async (req, res) => {
  // Hämta alla kolumner från orders men bara specifika saker från dishes, .title .day_of_week..
  const sql = `
        SELECT orders.*, dishes.title, dishes.day_of_week, dishes.price
        FROM orders
        LEFT JOIN dishes ON orders.dish_id = dishes.id
        ORDER BY orders.id DESC
    `;

  try {
    const result = await db.execute(sql);
    // Turso sparar raderna i .rows
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Kunde inte hämta ordrar" });
  }
});

// Route för att uppdatera en specifik maträtt (kräver JWT)
app.put("/api/dishes/:id", authenticateToken, async (req, res) => {
  const dishId = req.params.id;
  const { title, description, price } = req.body;

  if (!title) {
    return res.status(400).json({ message: "Rättens namn måste fyllas i." });
  }

  const sql = `
    UPDATE dishes
    SET title = ?, description = ?, price = ?
    WHERE id = ?
  `;

  // Om description eller price inte skickas med så sätts de till tom sträng eller 0 i databasen
  try {
    const result = await db.execute({
      sql,
      args: [title, description || "", price || 0, dishId],
    });

    // RowsAffected istället för this.changes med Turso
    if (result.rowsAffected === 0) {
      return res
        .status(404)
        .json({ message: "Ingen maträtt hittades med detta id." });
    }

    res.json({
      message: "Maträtten har uppdaterats!",
      changes: result.rowsAffected,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Kunde inte uppdatera maträtten." });
  }
});

// Route för att uppdatera orderstatus (kräver JWT)
app.put("/api/orders/:id", authenticateToken, async (req, res) => {
  const orderId = req.params.id;
  const { order_status } = req.body; // uppdatering av orderstatus

  if (!order_status) {
    return res.status(400).json({ error: "Status måste skickas med." });
  }

  const sql = `UPDATE orders SET order_status = ? WHERE id = ?`;

  try {
    const result = await db.execute({ sql, args: [order_status, orderId] });
    res.json({
      message: "Orderstatus uppdaterad!",
      changes: result.rowsAffected,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Kunde inte uppdatera status" });
  }
});

// Route för att radera en specifik maträtt ur en veckomeny (kräver JWT), blir sedan cascaderaderade
app.delete(
  "/api/dishes/week/:year/:week",
  authenticateToken,
  async (req, res) => {
    const { year, week } = req.params;
    const sql = `DELETE FROM menus WHERE year = ? AND week_number = ?`;

    try {
      await db.execute({ sql, args: [year, week] });
      res.json({ message: "Veckomenyn har raderats!" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Kunde inte radera menyn." });
    }
  },
);

// Route för att radera en order (kräver JWT)
app.delete("/api/orders/:id", authenticateToken, async (req, res) => {
  const orderId = req.params.id;
  const sql = `DELETE FROM orders WHERE id = ?`;

  try {
    await db.execute({ sql, args: [orderId] });
    res.json({ message: "Ordern har raderats!" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Kunde inte radera menyn." });
  }
});

// Route för att lägga till meny för en hel vecka (kräver JWT)
app.post("/api/addmenu", authenticateToken, async (req, res) => {
  const { year, week_number, dishes } = req.body;

  // Validering att år, vecka och rätter finns som en icke tom array
  if (!year || !week_number || !Array.isArray(dishes) || dishes.length === 0) {
    return res
      .status(400)
      .json({ message: "Fyll i datumfält och minst en rätt!" });
  }

  const menuSql = `INSERT INTO menus (year, week_number) VALUES (?, ?)`;

  try {
    const menuResult = await db.execute({
      sql: menuSql,
      args: [year, week_number],
    });
    const newMenuId = menuResult.lastInsertRowid;

    const dishSql = `
    INSERT INTO dishes (menu_id, day_of_week, title, description, price) 
  VALUES (?, ?, ?, ?, ?)
`;
    // for-of loop för att await ska fungera korrekt
    for (const dish of dishes) {
      if (!dish.day_of_week || !dish.title) {
        return res.status(400).json({
          message: "Veckodag och maträttsnamn krävs för alla rätter!",
        });
      }

      await db.execute({
        sql: dishSql,
        args: [
          newMenuId,
          dish.day_of_week,
          dish.title,
          dish.description || "",
          dish.price || 0,
        ],
      });
    }

    return res.status(201).json({ message: "Veckan har lagts till!" });
  } catch (err) {
    console.error(err);
    if (err.message.includes("UNIQUE constraint failed")) {
      // Hanterar dubbletter
      return res
        .status(400)
        .json({ message: "Det finns redan en meny för denna vecka!" });
    }
    return res.status(500).json({ message: "Kunde inte skapa veckomenyn." });
  }
});

// Route för att hämta alla menyer (kräver ej JWT)
app.get("/api/menus", async (req, res) => {
  const weekNumber = req.query.week_number
    ? Number(req.query.week_number)
    : null;
  const year = req.query.year ? Number(req.query.year) : null;

  if (!weekNumber || !year) {
    return res
      .status(400)
      .json({ message: "Du måste ange både veckonummer och år!" });
  }

  // Hämta rätter och datum för veckan med en join mellan dishes- och menusrader som finns i båda tabellerna baserat på week_number, sortera efter id för att få rätterna i den ordning de lades till
  const sql = `
    SELECT dishes.id, dishes.day_of_week, dishes.title, dishes.description, dishes.price 
    FROM dishes 
    JOIN menus ON dishes.menu_id = menus.id
    WHERE menus.week_number = ? AND menus.year = ?
    ORDER BY dishes.id ASC
  `;

  try {
    const result = await db.execute({ sql, args: [weekNumber, year] });
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(400).json({ message: "Något gick fel!" });
  }
});

// Registrera användare
app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validera input
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Alla fält (email, password) måste fyllas i!" });
    }

    // Kontrollera att det är en korrekt e-postadress
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Ogiltig e-postadress!" });
    }

    // Kontrollera att lösenordet är minst 6 tecken långt
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Lösenordet måste vara minst 6 tecken långt!" });
    }

    // Om användaren inte finns, hasha lösenord och lagra användare i databasen
    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    // Kolla om användaren redan finns
    const sqlCheck = `SELECT * FROM users WHERE email = ?`;
    const checkResult = await db.execute({ sql: sqlCheck, args: [email] });

    if (checkResult.rows.length > 0) {
      return res
        .status(400)
        .json({ message: "E-posten är redan registrerad!" });
    }

    // Lagra i databasen
    const sql = `INSERT INTO users (email, password) VALUES (?, ?)`;
    await db.execute({ sql, args: [email, hashedPassword] });

    res.status(201).json({ message: "Användare registrerad!" });
  } catch (err) {
    console.error(err);
    res.status(500).send();
  }
});

// Logga in användare
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  // Validera input
  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Alla fält (email, password) måste fyllas i!" });
  }

  // Kolla om användaren finns
  try {
    const sql = `SELECT * FROM users WHERE email = ?`;
    const result = await db.execute({ sql, args: [email] });

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "E-postadressen finns inte!" });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(400).json({ message: "Felaktigt lösenord!" });
    }

    // Skapa och skicka JWT
    const payload = { email: user.email };
    const token = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
      expiresIn: "3h",
    });
    res.status(200).json({ message: "Inloggad!", token });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Något gick fel!" });
  }
});

// Validera JWT-token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (token == null)
    return res.status(401).json("Nekad åtkomst - saknas token");

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).json("ogiltig token");

    req.user = user;
    next();
  });
}

// Starta servern
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servern körs på port ${PORT}`);
});
