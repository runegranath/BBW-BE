# Veckomeny & Beställningssystem - Backend

Detta är backenden för ett system som hanterar veckomenyer, maträtter och kundbeställningar. Systemet har även ett inbyggt användarsystem för administratörer/inloggad personal som ska kunna hantera menyerna och beställningar.

Projektet är byggt med **Node.js**, **Express** och **SQLite**.

---

## Features

* **Användarhantering (Users):** Registrering och lagring av administratörer med krypterade lösenord.
* **Menyhantering (Menus):** Skapa unika veckomenyer baserade på år och veckonummer.
* **Maträtter (Dishes):** Koppla maträtter till specifika dagar i en veckomeny (med `ON DELETE CASCADE` som rensar veckan om en maträtt raderas).
* **Beställningar (Orders):** Hantera kundbeställningar på specifika maträtter med status (pending, etc.), kvantitet och upphämtningstid.

---

## Database Architecture (ER-Diagram)

Databasen är uppbyggd som en relationsdatabas i SQLite med fyra huvudtabeller:
* `users`
* `menus`
* `dishes`
* `orders`

*Relationer:* En meny innehåller flera maträtter (1:N), och en maträtt kan finnas i flera beställningar (1:N). Alla inloggade administratörer/medarbetare har behörighet att hantera menyerna.

---

