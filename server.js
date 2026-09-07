const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const QRCode = require("qrcode");
const Groq = require("groq-sdk");
const app = express();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

app.use(express.json());


// ===============================
// MIDDLEWARE
// ===============================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: "dr-doctor-sih-secret",
        resave: false,
        saveUninitialized: false
    })
);


// ===============================
// DATABASE
// ===============================

const db = new Database(
    path.join(__dirname, "notes.db")
);


// ===============================
// CREATE TABLES
// ===============================
db.prepare(`
    CREATE TABLE IF NOT EXISTS consultations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        doctor_id INTEGER NOT NULL,

        patient_id TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        patient_age INTEGER,
        patient_gender TEXT,
        patient_phone TEXT,
        patient_blood_group TEXT,

        language TEXT,

        conversation TEXT,

        report TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (doctor_id)
        REFERENCES doctors(id)
    )
`).run();
db.exec(`
    CREATE TABLE IF NOT EXISTS access_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER NOT NULL,
        code TEXT UNIQUE NOT NULL,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (doctor_id)
        REFERENCES doctors(id)
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);


// ===============================
// SERVE FRONTEND
// ===============================

app.use(
    express.static(
        path.join(__dirname, "frontend")
    )
);


// ===============================
// HOME
// ===============================

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "frontend", "index.html")
    );
});


// ===============================
// DOCTOR REGISTER
// ===============================

app.post("/api/doctor/register", async (req, res) => {

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({
            success: false,
            message: "Please fill all fields."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            success: false,
            message: "Password must be at least 6 characters."
        });
    }

    try {

        const existingDoctor = db
            .prepare("SELECT * FROM doctors WHERE email = ?")
            .get(email);

        if (existingDoctor) {
            return res.status(400).json({
                success: false,
                message: "An account with this email already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = db
            .prepare(`
                INSERT INTO doctors
                (name, email, password)
                VALUES (?, ?, ?)
            `)
            .run(name, email, hashedPassword);

        res.json({
            success: true,
            message: "Doctor account created successfully!",
            doctorId: result.lastInsertRowid
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Something went wrong."
        });
    }
});


// ===============================
// DOCTOR LOGIN
// ===============================

app.post("/api/doctor/login", async (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: "Please enter email and password."
        });
    }

    try {

        const doctor = db
            .prepare("SELECT * FROM doctors WHERE email = ?")
            .get(email);

        if (!doctor) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const passwordCorrect = await bcrypt.compare(
            password,
            doctor.password
        );

        if (!passwordCorrect) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        req.session.doctorId = doctor.id;
        req.session.doctorName = doctor.name;

        res.json({
            success: true,
            message: "Login successful!",
            doctor: {
                id: doctor.id,
                name: doctor.name,
                email: doctor.email
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Something went wrong."
        });
    }
});


// ===============================
// CHECK LOGGED-IN DOCTOR
// ===============================

app.get("/api/doctor/me", (req, res) => {

    if (!req.session.doctorId) {
        return res.status(401).json({
            success: false,
            message: "Not logged in."
        });
    }

    res.json({
        success: true,
        doctor: {
            id: req.session.doctorId,
            name: req.session.doctorName
        }
    });
});


// ===============================
// LOGOUT
// ===============================

app.post("/api/doctor/logout", (req, res) => {

    req.session.destroy(() => {

        res.json({
            success: true,
            message: "Logged out successfully."
        });

    });
});

// ===============================
// DOCTOR DASHBOARD
// ===============================

app.get("/api/doctor/dashboard", (req, res) => {

    if (!req.session.doctorId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    const doctor = db
        .prepare(`
            SELECT id, name, email, created_at
            FROM doctors
            WHERE id = ?
        `)
        .get(req.session.doctorId);

    const codes = db
        .prepare(`
            SELECT *
            FROM access_codes
            WHERE doctor_id = ?
            ORDER BY created_at DESC
        `)
        .all(req.session.doctorId);
    
    const consultations = db.prepare(`
        SELECT
            id,
            patient_id,
            patient_name,
            patient_age,
            patient_gender,
            patient_phone,
            patient_blood_group,
            language,
            report,
            created_at
        FROM consultations
        WHERE doctor_id = ?
        ORDER BY created_at DESC
    `).all(req.session.doctorId);    

    res.json({
        success: true,
        doctor,
        codes,
        consultations
    });
});
// ===============================
// GENERATE PATIENT ACCESS CODE
// ===============================

app.post("/api/doctor/generate-code", async (req, res) => {

    if (!req.session.doctorId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    try {

        const doctorId = req.session.doctorId;

        // Generate random code
        const randomPart = Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();

        const code = "DR-" + randomPart;

        // Save code
        db.prepare(`
            INSERT INTO access_codes
            (doctor_id, code)
            VALUES (?, ?)
        `).run(doctorId, code);

        // QR contains the access code
        const patientUrl =
            `${req.protocol}://${req.get("host")}/patient.html?code=${code}`;

        const qrData =
            await QRCode.toDataURL(patientUrl);

        res.json({
            success: true,
            code: code,
            qr: qrData
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Could not generate access code."
        });
    }
});

// ===============================
// PATIENT ACCESS CODE VERIFICATION
// ===============================

app.post("/api/patient/access", (req, res) => {

    const { code } = req.body;

    if (!code) {

        return res.status(400).json({
            success: false,
            message: "Please enter an access code."
        });

    }


    const accessCode = db
        .prepare(`
            SELECT
                access_codes.id,
                access_codes.code,
                access_codes.active,
                doctors.id AS doctor_id,
                doctors.name AS doctor_name
            FROM access_codes

            JOIN doctors
            ON access_codes.doctor_id = doctors.id

            WHERE access_codes.code = ?
        `)
        .get(code);


    if (!accessCode) {

        return res.status(404).json({
            success: false,
            message: "Invalid access code."
        });

    }


    if (!accessCode.active) {

        return res.status(403).json({
            success: false,
            message: "This access code is no longer active."
        });

    }


    res.json({

        success: true,

        doctor: {
            id: accessCode.doctor_id,
            name: accessCode.doctor_name
        }

    });

});
// ===============================
// START SERVER
// ===============================

// ===============================
// REAL AI PATIENT INTERVIEW
// ===============================

app.post("/api/patient/interview", async (req, res) => {

    try {

        const {
            message,
            language,
            conversation
        } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: "Please provide a message."
            });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                message: "Gemini API key is not configured."
            });
        }

        

        // Convert previous conversation into text
        const conversationText =
            (conversation || [])
                .map(item => {
                    const role =
                        item.role === "patient"
                            ? "Patient"
                            : "AI Assistant";

                    return `${role}: ${item.message}`;
                })
                .join("\n");


        // Instructions for our AI
        const systemInstruction = `

You are Dr.Doctor, an AI pre-consultation medical history assistant.

Your job is to collect useful medical history from a patient before they speak with a doctor.

IMPORTANT:

- Do NOT diagnose the patient.
- Do NOT prescribe medicines.
- Do NOT claim the patient definitely has a disease.
- Ask ONE question at a time.
- Keep questions simple and easy to understand.
- Use the patient's selected language: ${language || "English"}.
- Remember previous answers.
- Ask follow-up questions based on the patient's answers.
- Do not unnecessarily repeat questions.

Try to collect:

1. Main health problem
2. Duration and onset
3. Symptoms
4. Severity
5. Location when relevant
6. Other associated symptoms
7. Current medicines
8. Allergies
9. Previous medical conditions
10. Previous treatments
11. Relevant history when appropriate

If the patient gives an unclear answer, ask for clarification.

If the patient mentions potentially serious warning symptoms,
tell them to seek urgent medical attention rather than diagnosing them.

Be calm, respectful and reassuring.

Ask only ONE useful question at a time.

You are helping collect information for a doctor.
You are NOT replacing the doctor.

`;


        const prompt = `

Conversation so far:

${conversationText}

Newest patient answer:

Patient: ${message}

Based on the entire conversation, decide what information
would be most useful to collect next.

Ask ONE question only.

Do not explain your reasoning.

`;


        const completion =
            await groq.chat.completions.create({
                model: "openai/gpt-oss-20b",

                messages: [
                    {
                        role: "system",
                        content: systemInstruction
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],

                temperature: 0.3,
                max_tokens: 300
            });

        const reply =
            completion.choices[0]?.message?.content;


        res.json({

            success: true,

            reply:
                reply ||
                "Could you tell me a little more about your symptoms?",

            language:
                language || "English"

        });

    }

    catch (error) {

        console.error(
            "Gemini interview error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "The AI assistant could not respond right now."

        });

    }

});
// ===============================
// GENERATE PATIENT REPORT
// ===============================

app.post("/api/patient/report", async (req, res) => {

    try {

        const {
            conversation,
            language,
            patientDetails,
            accessCode
        } = req.body;


        // Check conversation

        if (!conversation || conversation.length === 0) {

            return res.status(400).json({
                success: false,
                message: "No consultation conversation found."
            });

        }


        

       

        // Convert conversation to text

        const conversationText =
            conversation
                .map(item => {

                    const role =
                        item.role === "patient"
                            ? "Patient"
                            : "AI Assistant";

                    return `${role}: ${item.message}`;

                })
                .join("\n");


        // Report instructions

        const systemInstruction = `

You are Dr.Doctor's medical pre-consultation report generator.

Create a clear, structured summary of the patient's conversation
for a licensed doctor who will see the patient next.

IMPORTANT:

- Do NOT diagnose the patient.
- Do NOT prescribe medicines.
- Do NOT invent information.
- Only include information actually provided by the patient.
- Clearly mark information as "Not provided" when necessary.
- Keep the report professional and easy for a doctor to scan.
- The report is a PRE-CONSULTATION summary, not a diagnosis.

Create these sections:

1. Chief Complaint
2. Duration / Onset
3. Symptoms
4. Severity
5. Associated Symptoms
6. Current Medications
7. Allergies
8. Previous Medical History
9. Previous Treatments
10. Relevant History
11. Patient's Own Description
12. Important Symptoms / Concerns for Doctor to Review
13. Overall Pre-Consultation Summary

If information is missing, write:
"Not provided"

The report should be written in:
${language || "English"}

`;


        const prompt = `

PATIENT INFORMATION:

Patient ID: ${patientDetails?.patientId || "Not provided"}
Name: ${patientDetails?.name || "Not provided"}
Age: ${patientDetails?.age || "Not provided"}
Gender: ${patientDetails?.gender || "Not provided"}
Phone: ${patientDetails?.phone || "Not provided"}
Blood Group: ${patientDetails?.bloodGroup || "Not provided"}
Consultation Date: ${
    patientDetails?.consultationDate
        ? new Date(patientDetails.consultationDate).toLocaleDateString()
        : "Not provided"
}


COMPLETE PATIENT-AI CONVERSATION:

${conversationText}


Generate the structured pre-consultation report now.

Start the report with the patient's personal information.

Do not invent any information.

Do not explain how you generated the report.

Return only the report.

`;


        // Generate report

        const completion =
            await groq.chat.completions.create({
                model: "openai/gpt-oss-20b",

                messages: [
                    {
                        role: "system",
                        content: systemInstruction
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],

                temperature: 0.2,
                max_tokens: 1500
            });

        const report =
            completion.choices[0]?.message?.content;
        // Find the doctor using the patient's access code
        const accessData = db.prepare(`
            SELECT doctor_id
            FROM access_codes
            WHERE code = ? AND active = 1
        `).get(accessCode);

        if (!accessData) {
            return res.status(400).json({
                success: false,
                message: "Invalid or inactive access code."
            });
        }

        // Save consultation in database
        db.prepare(`
            INSERT INTO consultations (
                doctor_id,
                patient_id,
                patient_name,
                patient_age,
                patient_gender,
                patient_phone,
                patient_blood_group,
                language,
                conversation,
                report
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            accessData.doctor_id,
            patientDetails?.patientId || "Not provided",
            patientDetails?.name || "Not provided",
            patientDetails?.age || null,
            patientDetails?.gender || "Not provided",
            patientDetails?.phone || "",
            patientDetails?.bloodGroup || "",
            language || "English",
            JSON.stringify(conversation),
            report || "Unable to generate the report."
        );    


    


        // Send report to frontend

        res.json({

            success: true,

            report:
                report ||
                "Unable to generate the report."

        });


    } catch (error) {

        console.error(
            "Report generation error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Could not generate patient report."

        });

    }

});

app.listen(3000, "0.0.0.0", () => {
    console.log("🩺 Dr.Doctor server running on port 3000");
});