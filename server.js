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

app.post('/api/orders', (req, res) => {
    // Hämta data från request body för att skapa beställningen
    const { dish_id, customer_name, customer_phone, pickup_time, quantity } = req.body;

    // Validering: Kontrollerar ifyllda fält
    if (!dish_id || !customer_name || !customer_phone || !pickup_time) {
        return res.status(400).json({ error: 'Alla fält måste vara ifyllda.' });
    }

    const sql = `
        INSERT INTO orders (dish_id, customer_name, customer_phone, pickup_time, quantity)
        VALUES (?, ?, ?, ?, ?)
    `;
    
    // 1 sätts som default och är valfritt att skicka med 
    const params = [dish_id, customer_name, customer_phone, pickup_time, quantity || 1];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Databasfel:', err.message);
            return res.status(500).json({ error: 'Något gick fel' });
        }

        // vid lyckad insättning skickas id tillbaka i svaret 
        res.status(201).json({
            message: 'Beställning mottagen!',
            orderId: this.lastID
        });
    });
});

// Route för att lägga till meny för en hel vecka (kräver JWT)
app.post("/api/addmenu", authenticateToken, (req, res) => {
  const { year, week_number, dishes } = req.body;

  // Validering att år, vecka  och rätter finns som en icke tom array
  if (!year || !week_number || !Array.isArray(dishes) || dishes.length === 0) {
    return res.status(400).json({ message: "Fullständig vecka krävs!" });
  }

  const menuSql = `INSERT INTO menus (year, week_number) VALUES (?, ?)`;

  db.run(menuSql, [year, week_number], function (err) {
    if (err) {
      console.error(err);

      if (err.message.includes("UNIQUE constraint failed")) {
        return res
          .status(400)
          .json({ message: "Det finns redan en meny för denna vecka!" }); // specifik felhantering för unikt tillagda datumkombinationer
      }
      return res.status(500).json({ message: "Kunde inte skapa veckomenyn." });
    }

    const newMenuId = this.lastID;

    const dishSql = `
    INSERT INTO dishes (menu_id, day_of_week, title, description, price) 
  VALUES (?, ?, ?, ?, ?)
`;
    // en räknare för att hålla koll på när alla rätter har lagts till och en errorflagga
    let completedDishes = 0;
    let hasError = false;

    // Loopa igenon rätter och lägg till i db
    dishes.forEach((dish) => {
      if (hasError) return; // Stoppa vid fel

      // vidare validering av varje rätt på veckodag och maträttsnamn innan sparning
      if (!dish.day_of_week || !dish.title) {
        hasError = true;
        return res.status(400).json({
          message: "Veckodag och maträttsnamn krävs för alla rätter!",
        });
      }

      // spara varje rätt, beskrivning och pris är valfria
      db.run(
        dishSql,
        [
          newMenuId, // Koppla rätten till den nya menyn
          dish.day_of_week,
          dish.title,
          dish.description || "",
          dish.price || 0,
        ],
        (dishErr) => {
          if (dishErr) {
            console.error("Fel vid insättning av rätt:", dishErr.message);
            hasError = true;
            return res
              .status(500)
              .json({ message: "Något gick fel vid sparande av rätt." });
          }

          completedDishes++;

          // När alla rätter är sparade och inga fel har inträffat, skicka lyckat svar
          if (completedDishes === dishes.length && !hasError) {
            return res.status(201).json({ message: "Veckan har lagts till!" });
          }
        },
      );
    });
  });
});

// Route för att hämta alla menyer (kräver ej JWT)
app.get("/api/menus", (req, res) => {
  const weekNumber = req.query.week_number ? Number(req.query.week_number) : null;
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

  db.all(sql, [weekNumber, year], (err, rows) => {
    if (err) {
      return res.status(400).json({ message: "Något gick fel!" });
    } else {
      // Skicka tillbaka rätterna som json
      return res.status(200).json(rows);
    }
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
          expiresIn: "3h",
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
