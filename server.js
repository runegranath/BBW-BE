require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt"); // Hasha lösenord
const cors = require("cors");

// Express
const app = express();
app.use(express.json()); // För att kunna läsa av JSON-data i body
const jwt = require("jsonwebtoken"); // JSON Web Token (JWT)

// Aktivera CORS (Cross-Origin Resource Sharing) för att tillåta frontend att kommunicera med backend
app.use(cors());

// SQLite-anslutning
const db = new sqlite3.Database(process.env.DATABASE); // Anslut till databasen

// Routes
app.get("/api", (req, res) => {
  res.json({ message: "Välkommen till API:et!" });
});

// Skyddad route som kräver JWT-token
app.get("/api/protected", authenticateToken, (req, res) => {
  res.json({ message: "Skyddad route!" });
});

// Route för att lägga till menyer (kräver JWT)
app.post("/api/addmenu", authenticateToken, (req, res) => {
  const { year, week_number } = req.body;
  if (!year || !week_number) {
    return res
      .status(400)
      .json({ message: "Alla fält (year, week_number) måste fyllas i!" });
  }

  const sql = `INSERT INTO menus (year, week_number) VALUES (?, ?)`;
  db.run(sql, [year, week_number], function (err) {
    if (err) {
      res.status(400).json({ message: "Något gick fel!" });
    } else {
      res.status(201).json({ message: "Meny tillagd!", menuId: this.lastID });
    }
  });
});

// Route för att lägga till en maträtt (kräver JWT)
app.post("/api/adddishes", authenticateToken, (req, res) => {
  const { year, week_number, day_of_week, title, description, price } = req.body;

  // Validering av obligatoriska fält
  if (!year || !week_number || !day_of_week || !title) {
    return res.status(400).json({ 
      message: "fälten för år, vecka, dag och maträttens namn måste fyllas i!" 
    });
  }

  const sql = `
    INSERT INTO dishes (year, week_number, day_of_week, title, description, price) 
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.run(sql, [year, week_number, day_of_week, title, description, price], function (err) {
    if (err) {
      console.error(err);
      res.status(400).json({ message: "Något gick fel" });
    } else {
      res.status(201).json({ message: "Maträtt tillagd!", dishId: this.lastID });
    }
  });
});

// Route för att hämta alla menyer (kräver ej JWT)
app.get("/api/menus", (req, res) => {
  const weekNumber = req.query.week_number;

  if (!weekNumber) {
    return res.status(400).json({ message: "Du måste ange ett veckonummer!" });
  }

  // Hämta rätterna för den angivna veckan, inklusive menyinfo
  const sql = `
    SELECT id, day_of_week, title, description, price 
    FROM dishes 
    WHERE year = 2026 AND week_number = ?
    ORDER BY day_of_week ASC
  `;

  db.all(sql, [weekNumber], (err, rows) => {
    if (err) {
      return res.status(400).json({ message: "Något gick fel!" });
    }

    // Om inga rätter hittades, skicka felmeddelande om att det saknas meny
    if (rows.length === 0) {
      return res.status(404).json({
        message: "Det finns ingen meny inlagd för denna vecka ännu.",
      });
    }

    // Skicka tillbaka rätterna som json
    res.status(200).json(rows);
  });
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

    // Kolla om användaren redan finns
    const sqlCheck = `SELECT * FROM users WHERE email = ?`;
    db.get(sqlCheck, [email], async (err, row) => {
      if (err) {
        return res.status(400).json({ message: "Något gick fel!" });
      } else if (row) {
        return res
          .status(400)
          .json({ message: "E-posten är redan registrerad!" });
      }

      // Om användaren inte finns, hasha lösenord och lagra användare i databasen
      const hashedPassword = await bcrypt.hash(req.body.password, 10);

      // Lagra i databasen
      const sql = `INSERT INTO users (email, password) VALUES (?, ?)`;
      db.run(sql, [email, hashedPassword], function (err) {
        if (err) {
          res.status(400).json({ message: "Något gick fel!" });
        } else {
          res.status(201).json({ message: "Användare registrerad!" });
        }
      });
    });
  } catch {
    res.status(500).send();
  }
});

// Logga in användare
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  // Validera input
  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Alla fält (email, password) måste fyllas i!" });
  }

  // Kolla om användaren finns
  const sql = `SELECT * FROM users WHERE email = ?`;
  db.get(sql, [email], async (err, row) => {
    if (err) {
      res.status(400).json({ message: "Något gick fel!" });
    } else if (!row) {
      res.status(400).json({ message: "E-postadressen finns inte!" });
    } else {
      // Kolla om lösenordet stämmer
      const passwordMatch = await bcrypt.compare(password, row.password);
      if (!passwordMatch) {
        res.status(400).json({ message: "Felaktigt lösenord!" });
      } else {
        // Skapa och skicka JWT
        const payload = { email: row.email };
        const token = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "1h",
        });
        res.status(200).json({ message: "Inloggad!", token });
      }
    }
  });
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
