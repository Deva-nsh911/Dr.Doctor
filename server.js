require("dotenv").config();

const express = require("express");
const path = require("path");
const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
const cookieSession = require("cookie-session");
const QRCode = require("qrcode");
const Groq = require("groq-sdk");

const app = express();

app.set("trust proxy", 1);


// =====================================================
// ENVIRONMENT CHECK
// =====================================================

if (!process.env.TURSO_DATABASE_URL) {
    console.error("❌ TURSO_DATABASE_URL is missing.");
}

if (!process.env.TURSO_AUTH_TOKEN) {
    console.error("❌ TURSO_AUTH_TOKEN is missing.");
}

if (!process.env.GROQ_API_KEY) {
    console.error("❌ GROQ_API_KEY is missing.");
}


// =====================================================
// GROQ
// =====================================================

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});


// =====================================================
// TURSO DATABASE
// =====================================================

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});


// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// =====================================================
// DOCTOR SESSION
// =====================================================

app.use(
    cookieSession({
        name: "drdoctor_session",
        keys: [
            process.env.SESSION_SECRET || "dr-doctor-development-secret"
        ],
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 8
    })
);


// =====================================================
// DATABASE INITIALIZATION
// =====================================================

async function initializeDatabase() {

     await db.execute(`
        CREATE TABLE IF NOT EXISTS doctors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            gender TEXT,
            dob TEXT,
            phone TEXT,
            mbbs_college TEXT,
            mbbs_year TEXT,
            md_college TEXT,
            specialization TEXT,
            super_speciality_college TEXT,
            super_speciality TEXT,
            registration_no TEXT,
            registration_council TEXT,
            hospital TEXT,
            department TEXT,
            designation TEXT,
            city TEXT,
            experience TEXT,
            consultation_type TEXT,
            expertise TEXT,
            languages TEXT,
            certifications TEXT,
            awards TEXT,
            bio TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // =====================================================
    // ADD PROFILE COLUMNS TO EXISTING DATABASE
    // =====================================================

    const profileColumns = [
        ["gender", "TEXT"],
        ["dob", "TEXT"],
        ["phone", "TEXT"],
        ["mbbs_college", "TEXT"],
        ["mbbs_year", "TEXT"],
        ["md_college", "TEXT"],
        ["specialization", "TEXT"],
        ["super_speciality_college", "TEXT"],
        ["super_speciality", "TEXT"],
        ["registration_no", "TEXT"],
        ["registration_council", "TEXT"],
        ["hospital", "TEXT"],
        ["department", "TEXT"],
        ["designation", "TEXT"],
        ["city", "TEXT"],
        ["experience", "TEXT"],
        ["consultation_type", "TEXT"],
        ["expertise", "TEXT"],
        ["languages", "TEXT"],
        ["certifications", "TEXT"],
        ["awards", "TEXT"],
        ["bio", "TEXT"]
    ];

    for (const [column, type] of profileColumns) {

        try {

            await db.execute(`
                ALTER TABLE doctors
                ADD COLUMN ${column} ${type}
            `);

        } catch (error) {

            // Column already exists.
            // Ignore this error so the server can continue.
            if (!error.message.toLowerCase().includes("duplicate")) {
                console.log(
                    `Column ${column} may already exist.`
                );
            }
        }
    }


    // =====================================================
    // ACCESS CODES
    // =====================================================

    await db.execute(`
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


    // =====================================================
    // CONSULTATIONS
    // =====================================================

    await db.execute(`
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
    `);

    await db.execute(`
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

    await db.execute(`
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
    `);

    console.log("✅ Turso database initialized.");
}


// =====================================================
// SERVE FRONTEND
// =====================================================

app.use(
    express.static(
        path.join(__dirname, "frontend")
    )
);


// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "frontend", "index.html")
    );
});


// =====================================================
// DOCTOR REGISTER
// =====================================================

app.post("/api/doctor/register", async (req, res) => {

    const {
        name,
        email,
        password
    } = req.body;

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

        const existingDoctor = await db.execute({
            sql: `
                SELECT *
                FROM doctors
                WHERE email = ?
            `,
            args: [email]
        });

        if (existingDoctor.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "An account with this email already exists."
            });
        }

        const hashedPassword =
            await bcrypt.hash(password, 10);

        const result = await db.execute({
            sql: `
                INSERT INTO doctors
                (name, email, password)
                VALUES (?, ?, ?)
            `,
            args: [
                name,
                email,
                hashedPassword
            ]
        });

        res.json({
            success: true,
            message: "Doctor account created successfully!",
            doctorId: Number(result.lastInsertRowid)
        });

    } catch (error) {

        console.error("Doctor registration error:", error);

        res.status(500).json({
            success: false,
            message: "Something went wrong."
        });
    }
});


// =====================================================
// DOCTOR LOGIN
// =====================================================

app.post("/api/doctor/login", async (req, res) => {

    const {
        email,
        password
    } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: "Please enter email and password."
        });
    }

    try {

        const result = await db.execute({
            sql: `
                SELECT *
                FROM doctors
                WHERE email = ?
            `,
            args: [email]
        });

        const doctor = result.rows[0];

        if (!doctor) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const passwordCorrect =
            await bcrypt.compare(
                password,
                doctor.password
            );

        if (!passwordCorrect) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        req.session = {
            doctorId: Number(doctor.id),
            doctorName: doctor.name
        };

        res.json({
            success: true,
            message: "Login successful!",
            doctor: {
                id: Number(doctor.id),
                name: doctor.name,
                email: doctor.email
            }
        });

    } catch (error) {

        console.error("Doctor login error:", error);

        res.status(500).json({
            success: false,
            message: "Something went wrong."
        });
    }
});

// =====================================================
// GET LOGGED-IN DOCTOR PROFILE
// =====================================================

app.get("/api/doctor/me", async (req, res) => {

    if (!req.session || !req.session.doctorId) {

        return res.status(401).json({
            success: false,
            message: "Not logged in."
        });
    }

    try {

        const doctorId =
            Number(req.session.doctorId);

        const result = await db.execute({
            sql: `
                SELECT
                    id,
                    name,
                    email,
                    gender,
                    dob,
                    phone,
                    mbbs_college,
                    mbbs_year,
                    md_college,
                    specialization,
                    super_speciality_college,
                    super_speciality,
                    registration_no,
                    registration_council,
                    hospital,
                    department,
                    designation,
                    city,
                    experience,
                    consultation_type,
                    expertise,
                    languages,
                    certifications,
                    awards,
                    bio,
                    created_at
                FROM doctors
                WHERE id = ?
            `,
            args: [doctorId]
        });

        const doctor = result.rows[0];

        if (!doctor) {

            return res.status(404).json({
                success: false,
                message: "Doctor profile not found."
            });
        }

        res.json({
            success: true,
            doctor
        });

    } catch (error) {

        console.error(
            "Doctor profile error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not load doctor profile."
        });
    }
});

// =====================================================
// UPDATE DOCTOR PROFILE
// =====================================================

app.put("/api/doctor/profile", async (req, res) => {

    // -------------------------------------------------
    // CHECK LOGIN
    // -------------------------------------------------

    if (!req.session || !req.session.doctorId) {

        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }


    try {

        const doctorId =
            Number(req.session.doctorId);


        // -------------------------------------------------
        // GET PROFILE DATA
        // -------------------------------------------------

        const {
            name,
            gender,
            dob,
            phone,
            email,
            mbbs_college,
            mbbs_year,
            md_college,
            specialization,
            super_speciality_college,
            super_speciality,
            registration_no,
            registration_council,
            hospital,
            department,
            designation,
            city,
            experience,
            consultation_type,
            expertise,
            languages,
            certifications,
            awards,
            bio
        } = req.body;


        // -------------------------------------------------
        // BASIC VALIDATION
        // -------------------------------------------------

        if (!name || !email) {

            return res.status(400).json({
                success: false,
                message: "Name and email are required."
            });
        }


        // -------------------------------------------------
        // CHECK EMAIL
        // -------------------------------------------------

        const existingEmail = await db.execute({
            sql: `
                SELECT id
                FROM doctors
                WHERE email = ?
                AND id != ?
            `,
            args: [
                email,
                doctorId
            ]
        });


        if (existingEmail.rows.length > 0) {

            return res.status(400).json({
                success: false,
                message: "This email is already being used by another doctor."
            });
        }


        // -------------------------------------------------
        // UPDATE DATABASE
        // -------------------------------------------------

        await db.execute({

            sql: `
                UPDATE doctors
                SET
                    name = ?,
                    email = ?,
                    gender = ?,
                    dob = ?,
                    phone = ?,
                    mbbs_college = ?,
                    mbbs_year = ?,
                    md_college = ?,
                    specialization = ?,
                    super_speciality_college = ?,
                    super_speciality = ?,
                    registration_no = ?,
                    registration_council = ?,
                    hospital = ?,
                    department = ?,
                    designation = ?,
                    city = ?,
                    experience = ?,
                    consultation_type = ?,
                    expertise = ?,
                    languages = ?,
                    certifications = ?,
                    awards = ?,
                    bio = ?
                WHERE id = ?
            `,

            args: [
                name,
                email,
                gender || null,
                dob || null,
                phone || null,
                mbbs_college || null,
                mbbs_year || null,
                md_college || null,
                specialization || null,
                super_speciality_college || null,
                super_speciality || null,
                registration_no || null,
                registration_council || null,
                hospital || null,
                department || null,
                designation || null,
                city || null,
                experience || null,
                consultation_type || null,
                expertise || null,
                languages || null,
                certifications || null,
                awards || null,
                bio || null,
                doctorId
            ]
        });


        // -------------------------------------------------
        // UPDATE SESSION NAME
        // -------------------------------------------------

        req.session = {
            ...req.session,
            doctorId: doctorId,
            doctorName: name
        };


        // -------------------------------------------------
        // RESPONSE
        // -------------------------------------------------

        res.json({
            success: true,
            message: "Profile updated successfully."
        });


    } catch (error) {

        console.error(
            "Doctor profile update error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not update doctor profile."
        });
    }
});


// =====================================================
// LOGOUT
// =====================================================

app.post("/api/doctor/logout", (req, res) => {

    req.session = null;

    res.json({
        success: true,
        message: "Logged out successfully."
    });
});


// =====================================================
// DOCTOR DASHBOARD
// =====================================================

app.get("/api/doctor/dashboard", async (req, res) => {

    if (!req.session || !req.session.doctorId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    try {

        const doctorId =
            Number(req.session.doctorId);


        // ---------------------------------------------
        // DOCTOR
        // ---------------------------------------------

        const doctorResult = await db.execute({
            sql: `
                SELECT
                    id,
                    name,
                    email,
                    created_at
                FROM doctors
                WHERE id = ?
            `,
            args: [doctorId]
        });

        const doctor =
            doctorResult.rows[0] || null;


        // ---------------------------------------------
        // ACCESS CODES
        // ---------------------------------------------

        const codesResult = await db.execute({
            sql: `
                SELECT *
                FROM access_codes
                WHERE doctor_id = ?
                ORDER BY created_at DESC
            `,
            args: [doctorId]
        });

        const codes =
            codesResult.rows;


        // ---------------------------------------------
        // CONSULTATIONS
        // ---------------------------------------------

        const consultationsResult = await db.execute({
            sql: `
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
            `,
            args: [doctorId]
        });

        const consultations =
            consultationsResult.rows;


        res.json({
            success: true,
            doctor,
            codes,
            consultations
        });

    } catch (error) {

        console.error(
            "Dashboard error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not load dashboard."
        });
    }
});


// =====================================================
// GENERATE PATIENT ACCESS CODE
// =====================================================

app.post(
    "/api/doctor/generate-code",
    async (req, res) => {

        if (!req.session || !req.session.doctorId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        try {

            const doctorId =
                Number(req.session.doctorId);


            // -----------------------------------------
            // GENERATE RANDOM CODE
            // -----------------------------------------

            const randomPart =
                Math.random()
                    .toString(36)
                    .substring(2, 8)
                    .toUpperCase();

            const code =
                "DR-" + randomPart;


            // -----------------------------------------
            // SAVE CODE
            // -----------------------------------------

            await db.execute({
                sql: `
                    INSERT INTO access_codes
                    (doctor_id, code)
                    VALUES (?, ?)
                `,
                args: [
                    doctorId,
                    code
                ]
            });


            // -----------------------------------------
            // QR CODE
            // -----------------------------------------

            const patientUrl =
                `${req.protocol}://${req.get("host")}/patient.html?code=${code}`;

            const qrData =
                await QRCode.toDataURL(patientUrl);


            res.json({
                success: true,
                code,
                qr: qrData
            });

        } catch (error) {

            console.error(
                "Access code error:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Could not generate access code."
            });
        }
    }
);


// =====================================================
// PATIENT ACCESS CODE VERIFICATION
// =====================================================

app.post(
    "/api/patient/access",
    async (req, res) => {

        const { code } = req.body;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Please enter an access code."
            });
        }

        try {

            const result = await db.execute({
                sql: `
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
                `,
                args: [code]
            });

            const accessCode =
                result.rows[0];


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
                    id: Number(accessCode.doctor_id),
                    name: accessCode.doctor_name
                }

            });

        } catch (error) {

            console.error(
                "Patient access error:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Could not verify access code."
            });
        }
    }
);


// =====================================================
// REAL AI PATIENT INTERVIEW
// =====================================================

app.post(
    "/api/patient/interview",
    async (req, res) => {

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


            if (!process.env.GROQ_API_KEY) {

                return res.status(500).json({
                    success: false,
                    message: "Groq API key is not configured."
                });
            }


            // -----------------------------------------
            // CONVERSATION TEXT
            // -----------------------------------------

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


            // -----------------------------------------
            // AI SYSTEM INSTRUCTION
            // -----------------------------------------

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


            // -----------------------------------------
            // AI PROMPT
            // -----------------------------------------

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


            // -----------------------------------------
            // GROQ
            // -----------------------------------------

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
                completion
                    .choices[0]
                    ?.message
                    ?.content;


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
                "Groq interview error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "The AI assistant could not respond right now."

            });
        }
    }
);


// =====================================================
// GENERATE PATIENT REPORT
// =====================================================

// =====================================================
// GENERATE PATIENT REPORT
// =====================================================

app.post(
    "/api/patient/report",
    async (req, res) => {

        try {

            const {
                conversation,
                language,
                patientDetails,
                accessCode
            } = req.body;


            // -----------------------------------------
            // CHECK CONVERSATION
            // -----------------------------------------

            if (
                !conversation ||
                conversation.length === 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "No consultation conversation found."

                });

            }


            // -----------------------------------------
            // CHECK ACCESS CODE
            // -----------------------------------------

            if (!accessCode) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Access code is required."

                });

            }


            // -----------------------------------------
            // CONVERSATION TEXT
            // -----------------------------------------

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


            // -----------------------------------------
            // REPORT SYSTEM INSTRUCTION
            // -----------------------------------------

            const systemInstruction = `

You are Dr.Doctor's medical pre-consultation
report generator.

Your job is to transform the patient's interview
into a professional, structured pre-consultation
history for a doctor.

This report will be displayed inside a medical
dashboard.

IMPORTANT SAFETY RULES:

- Do NOT diagnose.
- Do NOT suggest a diagnosis.
- Do NOT prescribe medicines.
- Do NOT recommend medication.
- Do NOT invent information.
- Do NOT assume information that the patient
  did not provide.
- Do NOT turn symptoms into a disease name.
- Clearly write "Not provided" when information
  was not collected.
- Use only information present in the conversation.
- Preserve the patient's meaning.
- Keep the report factual and professional.
- If potentially serious warning symptoms are
  mentioned, clearly flag them for doctor review.
- Do not determine whether something is actually
  dangerous or diagnose an emergency condition.
- The doctor must make the final clinical judgment.

LANGUAGE:

Write the report in:

${language || "English"}

IMPORTANT:

Use clear section titles.

Do NOT use Markdown symbols such as:

**
###
*
-

Do NOT put stars around headings.

Do NOT write an introduction explaining the report.

Do NOT write a conclusion outside the requested
sections.

Return ONLY the structured report.

Use exactly this structure:

PATIENT CONCERN

[Brief description of the patient's main concern.
Use the patient's own description when possible.]

DURATION / ONSET

[When the problem started and how it began.
Write "Not provided" if unavailable.]

SYMPTOMS

[List the symptoms actually reported by the patient.
Use one symptom per line.]

SEVERITY

[Severity or intensity reported by the patient.
Include rating such as 1-10 if provided.
Write "Not provided" if unavailable.]

LOCATION

[Body location if relevant and provided.
Write "Not provided" if unavailable.]

ASSOCIATED SYMPTOMS

[Other symptoms occurring along with the main concern.
Write "None reported" only if the patient explicitly
denied associated symptoms.
Otherwise write "Not provided".]

CURRENT MEDICATIONS

[List medicines the patient explicitly said they
are currently taking.
Do not invent dosage.
Write "None reported" if explicitly denied.
Otherwise "Not provided".]

ALLERGIES

[List allergies explicitly mentioned.
Write "No known allergies reported" only if explicitly
stated by the patient.
Otherwise "Not provided".]

PREVIOUS MEDICAL HISTORY

[List previous medical conditions explicitly mentioned.
Do not infer conditions.]

PREVIOUS TREATMENTS

[List previous treatments or medical consultations
explicitly mentioned.]

RELEVANT HISTORY

[Other information from the conversation that could
be useful to the doctor.]

PATIENT'S OWN DESCRIPTION

[Short factual summary of how the patient describes
their problem.]

IMPORTANT INFORMATION FOR DOCTOR REVIEW

[List statements or symptoms that deserve attention
during consultation.

Do not diagnose.

If nothing specific was mentioned, write:
"No specific concern identified from the information provided."]

OVERALL PRE-CONSULTATION SUMMARY

[Concise factual summary of the patient's reported
history. Do not diagnose or recommend treatment.]

`;


            // -----------------------------------------
            // REPORT PROMPT
            // -----------------------------------------

            const prompt = `

PATIENT INFORMATION

Patient ID:
${patientDetails?.patientId || "Not provided"}

Name:
${patientDetails?.name || "Not provided"}

Age:
${patientDetails?.age || "Not provided"}

Gender:
${patientDetails?.gender || "Not provided"}

Phone:
${patientDetails?.phone || "Not provided"}

Blood Group:
${patientDetails?.bloodGroup || "Not provided"}

Consultation Date:
${
    patientDetails?.consultationDate
        ? new Date(
            patientDetails.consultationDate
        ).toLocaleDateString("en-IN")
        : "Not provided"
}


PATIENT-AI INTERVIEW

${conversationText}


TASK

Create the professional pre-consultation report
using ONLY the information above.

Follow the exact section order provided
in the system instructions.

Keep every section concise.

Do not diagnose.

Do not prescribe.

Do not invent.

Return ONLY the report.

`;


            // -----------------------------------------
            // GROQ
            // -----------------------------------------

            const completion =
                await groq.chat.completions.create({

                    model: "openai/gpt-oss-20b"
                    ,

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

                    temperature: 0.1,

                    max_tokens: 1800

                });


            const report =
                completion
                    .choices[0]
                    ?.message
                    ?.content
                    ?.trim();


            // -----------------------------------------
            // MAKE SURE REPORT EXISTS
            // -----------------------------------------

            if (!report) {

                return res.status(500).json({

                    success: false,

                    message:
                        "AI could not generate the report."

                });

            }


            // -----------------------------------------
            // FIND DOCTOR USING ACCESS CODE
            // -----------------------------------------

            const accessResult =
                await db.execute({

                    sql: `
                        SELECT doctor_id
                        FROM access_codes
                        WHERE code = ?
                        AND active = 1
                    `,

                    args: [
                        accessCode
                    ]

                });


            const accessData =
                accessResult.rows[0];


            if (!accessData) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid or inactive access code."

                });

            }


            // -----------------------------------------
            // SAVE CONSULTATION
            // -----------------------------------------

            await db.execute({

                sql: `
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
                `,

                args: [

                    Number(
                        accessData.doctor_id
                    ),

                    patientDetails?.patientId ||
                        "Not provided",

                    patientDetails?.name ||
                        "Not provided",

                    patientDetails?.age ||
                        null,

                    patientDetails?.gender ||
                        "Not provided",

                    patientDetails?.phone ||
                        "",

                    patientDetails?.bloodGroup ||
                        "",

                    language ||
                        "English",

                    JSON.stringify(
                        conversation
                    ),

                    report

                ]

            });


            // -----------------------------------------
            // SEND REPORT TO PATIENT
            // -----------------------------------------

            res.json({

                success: true,

                report

            });


        }

        catch (error) {

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

    }
);


// =====================================================
// DOCTOR CONSULTATION REPORT
// =====================================================

app.get(
    "/api/doctor/consultation/:id",
    async (req, res) => {

        if (!req.session || !req.session.doctorId) {

            return res.status(401).json({

                success: false,

                message:
                    "Please login first."

            });
        }


        try {

            const consultationId =
                req.params.id;

            const doctorId =
                Number(req.session.doctorId);


            const result =
                await db.execute({

                    sql: `
                        SELECT
                            id,
                            patient_id,
                            patient_name,
                            patient_age,
                            patient_gender,
                            patient_phone,
                            patient_blood_group,
                            language,
                            conversation,
                            report,
                            created_at

                        FROM consultations

                        WHERE id = ?
                        AND doctor_id = ?
                    `,

                    args: [
                        consultationId,
                        doctorId
                    ]

                });


            const consultation =
                result.rows[0];


            if (!consultation) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Consultation not found."

                });
            }


            res.json({

                success: true,

                consultation

            });

        }

        catch (error) {

            console.error(
                "Consultation report error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not load consultation."

            });
        }
    }
);


// =====================================================
// START SERVER
// =====================================================

async function startServer() {

    try {

        await initializeDatabase();

        const PORT =
            process.env.PORT || 3000;

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    `🩺 Dr.Doctor server running on port ${PORT}`
                );

            }
        );

    }

    catch (error) {

        console.error(
            "❌ Failed to start server:",
            error
        );

        process.exit(1);
    }
}


startServer();