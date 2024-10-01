const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose(); // Χρήση του sqlite3 για σύνδεση με τη βάση δεδομένων
const bcrypt = require('bcryptjs'); // Βιβλιοθήκη για κρυπτογράφηση

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Δημιουργία ή σύνδεση με τη βάση δεδομένων SQLite σε αρχείο "webscrDB.sqlite"
const db = new sqlite3.Database('./webscrDB.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        // Δημιουργία πίνακα για τα στοιχεία των χρηστών, αν δεν υπάρχει ήδη
        db.run(`CREATE TABLE IF NOT EXISTS billing_info (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT,
            username TEXT,
            password TEXT,
            data TEXT
        )`);
    }
});

// Helper function για αποθήκευση δεδομένων στη βάση
async function saveBillingData(service, username, password, newData) {
    try {
        // Κρυπτογράφηση του κωδικού
        const hashedPassword = await bcrypt.hash(password, 10); // Κρυπτογράφηση με επίπεδο ασφαλείας 10

        const newDueDate = newData.dueDate;
        const newPaymentAmount = newData.paymentAmount;

        // Έλεγχος αν υπάρχει ήδη εγγραφή με το ίδιο dueDate και paymentAmount
        const queryCheck = `SELECT * FROM billing_info WHERE service = ? AND data LIKE ?`;
        db.get(queryCheck, [service, `%${newDueDate}%${newPaymentAmount}%`], (err, row) => {
            if (err) {
                console.error('Error checking data:', err.message);
            } else if (row) {
                console.log(`Entry already exists for service: ${service} with dueDate: ${newDueDate} and paymentAmount: ${newPaymentAmount}`);
            } else {
                // Αν δεν υπάρχει ήδη, αποθήκευση των νέων δεδομένων
                const queryInsert = `INSERT INTO billing_info (service, username, password, data) VALUES (?, ?, ?, ?)`;
                db.run(queryInsert, [service, username, hashedPassword, JSON.stringify(newData)], function (err) {
                    if (err) {
                        console.error('Error inserting data:', err.message);
                    } else {
                        console.log(`Saved data for ${service} - Username: ${username}`);
                    }
                });
            }
        });

    } catch (error) {
        console.error('Error hashing password:', error.message);
    }
}

// Helper function για ανάκτηση δεδομένων από τη βάση
function getBillingData(callback) {
    const query = `SELECT service, username, data FROM billing_info`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching data:', err.message);
            callback(err, null);
        } else {
            callback(null, rows);
        }
    });
}

// Helper function για scraping DEI
async function scrapeDEI(username, password) {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--window-size=1920,1080',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36'
            ],
        });
        const page = await browser.newPage();

        // Μετάβαση στη σελίδα login της ΔΕΗ
        await page.goto('https://mydei.dei.gr/el/login/', { waitUntil: 'networkidle2' });

        // Αποδοχή των cookies αν εμφανίζονται
        const acceptCookiesButton = await page.$('#onetrust-accept-btn-handler');
        if (acceptCookiesButton) {
            await acceptCookiesButton.click();
            await new Promise(resolve => setTimeout(resolve, 2000)); // Αναμονή για το κλείσιμο του popup
        }

        // Login στη ΔΕΗ
        await page.type('#loginModel_Username', username);
        await page.type('#loginModel_Password', password);
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        // Μετάβαση στο dashboard
        await page.goto('https://mydei.dei.gr/el/', { waitUntil: 'networkidle2' });

        // Εξαγωγή των πληροφοριών λογαριασμού
        const billingInfo = await page.evaluate(() => {
            const accountNumber = document.querySelector('.e-card-type__txt')?.innerText.trim() || 'Not found';
            const address = document.querySelector('.b-card__title')?.innerText.trim() || 'Not found';
            const dueDate = document.querySelectorAll('.b-bill-sum-tiny__dd')[2]?.innerText.trim() || 'Not found';
            const paymentAmount = document.querySelector('.e-card-total__number')?.innerText.trim() || 'Not found';

            return {
                accountNumber,
                address,
                dueDate,
                paymentAmount
            };
        });

        console.log("DEI Billing Info:", billingInfo); // Debugging DEI data

        await browser.close();

        return { status: 'success', data: billingInfo };
    } catch (error) {
        console.error('Error during DEI scraping:', error.message);
        return { status: 'error', message: 'DEI scraping failed: ' + error.message };
    }
}

// Helper function για scraping Cosmote
async function scrapeCosmote(username, password) {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--window-size=1920,1080',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36'
            ],
        });
        const page = await browser.newPage();

        // Μετάβαση στη σελίδα login της Cosmote
        await page.goto('https://account.cosmote.gr/el/user-login', { waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Εισαγωγή username
        await page.type('#login', username);
        await page.evaluate(() => {
            document.querySelector('#next').click();
        });

        // Αναμονή για το πεδίο password
        await page.waitForSelector('#pwd', { visible: true });

        // Εισαγωγή password
        await page.type('#pwd', password);
        await page.evaluate(() => {
            document.querySelector('#next').click();
        });

        // Αναμονή για μετάβαση μετά το login
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // Μετάβαση στο dashboard
        await page.goto('https://my.cosmote.gr/selfcare/jsp/dashboard.jsp', { waitUntil: 'networkidle2' });

        // Πρόσθετος χρόνος για να φορτώσουν όλα τα στοιχεία
        await new Promise(resolve => setTimeout(resolve, 7000));

        // Εξαγωγή των πληροφοριών λογαριασμού
        const billingInfo = await page.evaluate(() => {
            const bills = [];
            const cardSections = document.querySelectorAll('.cardWhite.withMargin.searchFilterBox');

            cardSections.forEach((card) => {
                const connection = card.querySelector('.cardLabelDropdownEntry div')?.innerText.trim() || 'No connection';
                const billNumber = card.querySelector('.cardLabel div')?.innerText.trim() || 'No bill number';
                const amountUnits = card.querySelector('.amountUnits')?.innerText.trim() || '0';
                const amountCents = card.querySelector('.amountCents')?.innerText.trim() || '00';
                const totalAmount = `${amountUnits},${amountCents}€`;
                const dueDate = card.querySelector('.cardText')?.innerText.trim() || 'No due date';

                bills.push({
                    connection,
                    billNumber,
                    totalAmount,
                    dueDate
                });
            });

            return bills;
        });

        console.log("Cosmote Billing Info:", billingInfo);  // For debugging
        await browser.close();
        return { status: 'success', data: billingInfo };
    } catch (error) {
        console.error('Error during Cosmote scraping:', error.message);
        return { status: 'error', message: 'Cosmote scraping failed: ' + error.message };
    }
}

// Helper function για scraping ΔΕΥΑΠ
async function scrapeDeyap(username, password) {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--window-size=1920,1080',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36'
            ],
        });
        const page = await browser.newPage();

        // Βήμα 1: Μετάβαση στη σελίδα login της ΔΕΥΑΠ
        await page.goto('https://deyaponline.gr/login', { waitUntil: 'networkidle2' });

        // Βήμα 2: Εισαγωγή στοιχείων χρήστη
        await page.type('#username', username);
        await page.type('#password', password);

        // Βήμα 3: Πατάμε το κουμπί σύνδεσης
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        // Βήμα 4: Μετάβαση στη σελίδα accountinfo
        await page.goto('https://deyaponline.gr/water-account-user-login-redirect/accountinfo', { waitUntil: 'networkidle2' });

        // Βήμα 5: Τραβάμε τα στοιχεία από τον πίνακα
        const billingInfo = await page.evaluate(() => {
            const registryNumber = document.querySelector('td[rowspan="2"]')?.innerText.trim() || 'Not found';
            const consumer = document.querySelectorAll('td')[1]?.innerText.trim() || 'Not found';
            const address = document.querySelectorAll('td')[2]?.innerText.trim() || 'Not found';
            const position = document.querySelectorAll('td')[3]?.innerText.trim() || 'Not found';
            const region = document.querySelectorAll('td')[4]?.innerText.trim() || 'Not found';
            const status = document.querySelector('.state.publish .text')?.innerText.trim() || 'Not found';
            const balance = document.querySelectorAll('td')[7]?.innerText.trim() || 'Not found';

            return { registryNumber, consumer, address, position, region, status, balance };
        });

        console.log("ΔΕΥΑΠ Billing Info:", billingInfo);

        await browser.close();
        return { status: 'success', data: billingInfo };
    } catch (error) {
        console.error('Error during ΔΕΥΑΠ scraping:', error.message);
        return { status: 'error', message: 'ΔΕΥΑΠ scraping failed: ' + error.message };
    }
}

// POST route για scraping requests
app.post('/scrape', async (req, res) => {
    const { username, password, service } = req.body;

    if (service === 'dei') {
        const result = await scrapeDEI(username, password);
        if (result.status === 'success') {
            await saveBillingData('dei', username, password, result.data); // Αποθήκευση κρυπτογραφημένων δεδομένων
        }
        return res.json(result);
    } else if (service === 'cosmote') {
        const result = await scrapeCosmote(username, password);
        if (result.status === 'success') {
            await saveBillingData('cosmote', username, password, result.data); // Αποθήκευση κρυπτογραφημένων δεδομένων
        }
        return res.json(result);
    } else if (service === 'deyap') {
        const result = await scrapeDeyap(username, password);
        if (result.status === 'success') {
            await saveBillingData('deyap', username, password, result.data); // Αποθήκευση κρυπτογραφημένων δεδομένων
        }
        return res.json(result);
    } else {
        return res.status(400).json({ status: 'error', message: 'Invalid service' });
    }
});

// GET route για ανάκτηση αποθηκευμένων δεδομένων από τη βάση
app.get('/billing-info', (req, res) => {
    getBillingData((err, data) => {
        if (err) {
            return res.status(500).json({ status: 'error', message: 'Error fetching data' });
        } else {
            return res.json({ status: 'success', data });
        }
    });
});

const PORT = process.env.PORT || 321; // Χρήση δυναμικής θύρας ή fallback στη θύρα 321 αν δεν υπάρχει η μεταβλητή περιβάλλοντος
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});