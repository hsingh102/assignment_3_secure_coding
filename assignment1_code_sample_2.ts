import * as readline from 'readline';
import * as mysql from 'mysql';
import { exec } from 'child_process';
import * as http from 'http';
import nodemailer from "nodemailer";
import * as https from "https";
import { URL } from "url";

const dbConfig = {
    host: process.env.DB_HOST || 'mydatabase.com',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'changeme',
    database: process.env.DB_NAME || 'mydb'
};

function getUserInput(prompt = "Enter your name: "): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve, reject) => {
    rl.question(prompt, (answer) => {
      rl.close();

      const name = answer.trim();

      // Basic validation
      if (!name) return reject(new Error("Name is required"));
      if (name.length > 100) return reject(new Error("Name too long"));
      if (!/^[a-zA-Z0-9\s.'-]+$/.test(name)) {
        return reject(new Error("Invalid characters in name"));
      }

      resolve(name);
    });
  });
}

// Example usage
(async () => {
  try {
    const safeName = await getUserInput();
    console.log("Validated name:", safeName);
  } catch (err: any) {
    console.error("Input error:", err.message);
  }
})();


/**
 * Safe email sender 
 */
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  // Configure SMTP from environment vars (avoid hardcoding secrets)
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.example.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true", 
    auth: {
      user: process.env.SMTP_USER || "user",
      pass: process.env.SMTP_PASS || "pass",
    },
  });

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"No Reply" <noreply@example.com>',
      to,
      subject,
      text: body,
    });
    console.log("Email sent:", info.messageId);
  } catch (err: any) {
    console.error("Error sending email:", err.message || err);
  }
}

/**
 * Secure fetch for remote data
 * - REMOTE_URL must be an https:// URL
 
 */
export async function getData(remoteUrl: string): Promise<string> {
  
  let urlObj: URL;
  try {
    urlObj = new URL(remoteUrl);
  } catch (err) {
    throw new Error("Invalid remote URL");
  }

  if (urlObj.protocol !== "https:") {
    throw new Error("Only HTTPS endpoints are allowed");
  }

  // only allow requests to known hosts
  const allowedHosts = new Set([
    "jsonplaceholder.typicode.com", 
    "secure-api.example.com",
  ]);
  if (!allowedHosts.has(urlObj.hostname)) {
    throw new Error(`Remote host not allowed: ${urlObj.hostname}`);
  }

  const timeoutMs = 10_000;   
  const maxBytes = 1_000_000; 

  return new Promise((resolve, reject) => {
    const req = https.get(urlObj, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        
        res.resume();
        return reject(new Error(`Upstream returned status ${status}`));
      }

      let received = 0;
      let body = "";

      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          
          req.destroy(new Error("Response too large"));
          return;
        }
        body += chunk.toString("utf8");
      });

      res.on("end", () => resolve(body));
    });

    req.on("error", (err) => reject(err));

    // timeout to prevent hanging requests
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Request timed out"));
    });
  });
}

function saveToDb(data: string) {
  const connection = mysql.createConnection(dbConfig);

  // Parameterized query to prevent SQL injection (OWASP A03)
  const sql = "INSERT INTO mytable (column1, column2) VALUES (?, ?)";
  const params: [string, string] = [data, "Another Value"];

  connection.connect((err) => {
    if (err) {
      console.error("DB connection error:", err.message);
      
      try { connection.end(); } catch {}
      return;
    }

    connection.query(sql, params, (error, results: mysql.OkPacket) => {
      if (error) {
        console.error("Error executing query:", error.message);
      } else {
        console.log("Data saved. insertId:", results.insertId);
      }

      // Correct callback signature for .end()
      connection.end((endErr?: mysql.MysqlError) => {
        if (endErr) {
          console.error("Error closing DB connection:", endErr.message);
        }
      });
    });
  });
}


const REMOTE_URL =
  process.env.REMOTE_URL || "https://jsonplaceholder.typicode.com/todos/1";

(async () => {
  const userInput = await getUserInput();
  const data = await getData(REMOTE_URL); 
  saveToDb(data);
  await sendEmail("admin@example.com", "User Input", userInput);
})();
