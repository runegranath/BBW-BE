require("dotenv").config();

// SQLite
const { createClient } = require("@libsql/client");

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Skapar en asynkron funktion som körs direkt
(async () => {
  try {
    console.log("Startar installation av db..");

    // Skapa tabellen users
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created DATETIME DEFAULT CURRENT_TIMESTAMP 
    )`);
    console.log("Tabellen users skapad");

    // Skapa tabellen för menyer med id, år, veckonummer och publiceringsstatus, ska vara unik på år + veckonummer
    await db.execute(`CREATE TABLE IF NOT EXISTS menus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    UNIQUE(year, week_number)
)`);
    console.log("Tabellen menus skapad");

    // Maten, varje rad är en maträtt som kopplas till en vecka via menu_id och on delete cascade så att när en meny tas bort så tas alla maträtter för den veckan bort också
    await db.execute(`CREATE TABLE IF NOT EXISTS dishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    day_of_week VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,
    FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE
)`);

    // Beställningar
    await db.execute(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dish_id INTEGER NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    pickup_time TEXT NOT NULL, -- Lagrar tidpunkt för upphämtning
    order_status VARCHAR(50) DEFAULT 'pending', -- Default sätts till pending för att sedan kunna ändras 
    quantity INTEGER DEFAULT 1,
    FOREIGN KEY (dish_id) REFERENCES dishes(id)
)`);
    console.log("Tabellen orders skapad eller finns redan.");

    console.log("Databasinstallationen är klar!");
  } catch (err) {
    console.error(err);
  }
})();
