import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import express, { Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";

// 1. Firebase Admin SDK 초기화 (Application Default Credentials 활용)
// 서비스 계정 키 파일 없이 Cloud Functions 런타임 내장 IAM 권한으로 자동 인증됩니다.
initializeApp();
const db = getFirestore();

// 2. CORS 허용 Origin 화이트리스트 구성 ('*' 전면 허용 금지)
const ALLOWED_ORIGINS = [
  "https://behavior-bdi.pages.dev",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // 서버 간 호출(curl 등 origin 헤더 없음) 또는 화이트리스트에 포함된 경우 허용
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS 정책에 의해 차단된 오리진입니다."));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};

// 3. 솔트 포함 scrypt 암호화 해싱 및 타이밍 공격 방어 검증 헬퍼 (Node.js 내장 crypto)
// 저장 포맷: scrypt$v1$<salt>$<derivedKeyHex> (알고리즘 및 버전 명시)
function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$v1$${salt}$${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, combinedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    let salt: string | undefined;
    let key: string | undefined;

    if (combinedHash.startsWith("scrypt$v1$")) {
      const parts = combinedHash.split("$");
      // format: ["scrypt", "v1", salt, key]
      if (parts.length === 4) {
        salt = parts[2];
        key = parts[3];
      }
    } else if (combinedHash.includes(":")) {
      // 레거시/초기 포맷 fallback: salt:key
      const parts = combinedHash.split(":");
      if (parts.length === 2) {
        salt = parts[0];
        key = parts[1];
      }
    }

    if (!salt || !key) return resolve(false);

    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return resolve(false);
      const keyBuffer = Buffer.from(key!, "hex");
      if (keyBuffer.length !== derivedKey.length) return resolve(false);
      resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
    });
  });
}

// 4. 인메모리 무차별 대입(Brute-force) 방어 레이트 리미터 (1분당 5회 실패 시 429 차단)
interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}
const loginAttempts = new Map<string, RateLimitEntry>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { attempts: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.attempts >= 5) {
    return false;
  }
  entry.attempts += 1;
  return true;
}

function clearRateLimit(key: string): void {
  loginAttempts.delete(key);
}

// 5. 공통 비즈니스 로직 핸들러: classroom-info (GET)
// 학급의 존재 여부와 학급명만 안전하게 반환하며, 비밀번호/API키/학생정보는 일절 반환하지 않습니다.
async function handleClassroomInfo(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "허용되지 않은 HTTP 메서드입니다." });
    return;
  }

  const rawCode = req.query.code || req.query.classCode;

  if (!rawCode || typeof rawCode !== "string") {
    res.status(400).json({ error: "학급 코드가 필요합니다." });
    return;
  }

  const trimmedCode = rawCode.trim().toUpperCase();

  const CODE_REGEX = /^[A-Z0-9]{4,16}$/;
  if (!CODE_REGEX.test(trimmedCode)) {
    res.status(400).json({ error: "올바르지 않은 학급 코드 형식입니다." });
    return;
  }

  try {
    const docSnap = await db.collection("classrooms").doc(trimmedCode).get();

    if (!docSnap.exists) {
      res.status(200).json({
        exists: false,
      });
      return;
    }

    const data = docSnap.data();
    const classroomName =
      typeof data?.name === "string" && data.name.trim()
        ? data.name.trim()
        : "우리 학급";

    res.status(200).json({
      exists: true,
      name: classroomName,
    });
  } catch (error) {
    console.error("classroom-info 조회 중 서버 오류 발생:", error instanceof Error ? error.message : "알 수 없는 오류");
    res.status(500).json({
      error: "학급 정보를 조회하는 중 서버 오류가 발생했습니다.",
    });
  }
}

// 6. 공통 비즈니스 로직 핸들러: teacher-auth (POST /api/auth/teacher)
// 교사 비밀번호를 서버에서 검증하고, Firebase Auth Custom Token을 발급합니다.
async function handleTeacherAuth(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "허용되지 않은 HTTP 메서드입니다." });
    return;
  }

  const { classCode, password } = req.body || {};

  // 1) 입력값 유효성 검증
  if (!classCode || typeof classCode !== "string" || !password || typeof password !== "string") {
    res.status(400).json({ error: "학급 코드와 비밀번호를 모두 입력해 주세요." });
    return;
  }

  const trimmedCode = classCode.trim().toUpperCase();
  const trimmedPassword = password.trim();

  const CODE_REGEX = /^[A-Z0-9]{4,16}$/;
  if (!CODE_REGEX.test(trimmedCode) || trimmedPassword.length === 0 || trimmedPassword.length > 64) {
    res.status(400).json({ error: "학급 코드 또는 비밀번호 형식이 올바르지 않습니다." });
    return;
  }

  // 2) 무차별 대입 방어 레이트 리밋 검사 (IP 및 학급코드 기준)
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const rateLimitKey = `${clientIp}:${trimmedCode}`;
  if (!checkRateLimit(rateLimitKey)) {
    res.status(429).json({ error: "로그인 시도가 너무 많습니다. 1분 후 다시 시도해 주세요." });
    return;
  }

  try {
    const docRef = db.collection("classrooms").doc(trimmedCode);
    const docSnap = await docRef.get();

    // 학급 미존재 또는 비밀번호 불일치 시 동일한 401 응답으로 열거 공격(enumeration) 방지
    const genericAuthError = "학급 코드 또는 비밀번호가 올바르지 않습니다.";

    if (!docSnap.exists) {
      res.status(401).json({ error: genericAuthError });
      return;
    }

    const data = docSnap.data();
    let isAuthenticated = false;

    // 3) 비밀번호 검증 (passwordHash 우선 검증, 미존재 시 레거시 평문 검증)
    if (typeof data?.passwordHash === "string" && data.passwordHash) {
      isAuthenticated = await verifyPassword(trimmedPassword, data.passwordHash);
    } else if (typeof data?.password === "string" && data.password) {
      isAuthenticated = (data.password === trimmedPassword);

      if (isAuthenticated) {
        // 일치 시 신규 안전한 passwordHash 생성 및 점진적 마이그레이션 저장
        try {
          const newHash = await hashPassword(trimmedPassword);
          await docRef.set({ passwordHash: newHash }, { merge: true });
        } catch (migrateErr) {
          console.error("비밀번호 해시 마이그레이션 저장 실패 (로그인은 허용):", migrateErr instanceof Error ? migrateErr.message : "Error");
        }
      }
    }

    if (!isAuthenticated) {
      res.status(401).json({ error: genericAuthError });
      return;
    }

    // 성공 시 레이트 리밋 실패 기록 초기화
    clearRateLimit(rateLimitKey);

    // 4) Firebase Auth Custom Token 발급 (role: "teacher", classCode 포함)
    const uid = `teacher_${trimmedCode}`;
    const claims = {
      role: "teacher",
      classCode: trimmedCode,
    };

    const customToken = await getAuth().createCustomToken(uid, claims);
    const classroomName = typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "우리 학급";

    // 5) 안전한 응답 반환 (password, passwordHash, apiConfig 등 민감정보 일절 배제)
    res.status(200).json({
      success: true,
      token: customToken,
      name: classroomName,
    });
  } catch (error) {
    console.error("교사 인증 처리 중 서버 오류 발생:", error instanceof Error ? error.message : "알 수 없는 오류");
    res.status(500).json({ error: "교사 인증 처리 중 서버 오류가 발생했습니다." });
  }
}

// 7. Express 앱 구성
const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(cors(corsOptions));

// 엔드포인트 라우트 등록
app.get("/classroom-info", handleClassroomInfo);
app.get("/api/classroom-info", handleClassroomInfo);

app.post("/auth/teacher", handleTeacherAuth);
app.post("/api/auth/teacher", handleTeacherAuth);

// 8. Cloud Functions 2nd Gen HTTPS 엔드포인트 내보내기
export const api = onRequest(
  {
    region: "asia-northeast3",
    cors: false, // Express 미들웨어에서 정밀 CORS 제어 수행
    invoker: "public",
  },
  app
);

export const classroomInfo = onRequest(
  {
    region: "asia-northeast3",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
  },
  async (req, res) => {
    await handleClassroomInfo(req, res);
  }
);

export const teacherAuth = onRequest(
  {
    region: "asia-northeast3",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
  },
  async (req, res) => {
    await handleTeacherAuth(req, res);
  }
);
