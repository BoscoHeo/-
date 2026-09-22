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

// 7. 공통 비즈니스 로직 핸들러: student-auth (POST /api/auth/student)
// 학생 PIN을 서버에서 검증하고, Student Custom Token을 발급합니다.
async function handleStudentAuth(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "허용되지 않은 HTTP 메서드입니다." });
    return;
  }

  const { classCode, name, pin } = req.body || {};

  // 1) 입력값 유효성 검증
  if (!classCode || typeof classCode !== "string" || !name || typeof name !== "string" || !pin || typeof pin !== "string") {
    res.status(400).json({ error: "학급 코드, 이름, 비밀번호(4자리)를 모두 입력해 주세요." });
    return;
  }

  const trimmedCode = classCode.trim().toUpperCase();
  const trimmedName = name.trim();
  const trimmedPin = pin.trim();

  const CODE_REGEX = /^[A-Z0-9]{4,16}$/;
  const PIN_REGEX = /^\d{4}$/;

  if (!CODE_REGEX.test(trimmedCode) || trimmedName.length === 0 || trimmedName.length > 30 || !PIN_REGEX.test(trimmedPin)) {
    res.status(400).json({ error: "학급 코드, 이름 또는 비밀번호 형식이 올바르지 않습니다." });
    return;
  }

  // 2) 무차별 대입 방어 레이트 리밋 검사 (IP 및 학급코드, 이름 기준)
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const rateLimitKey = `student:${clientIp}:${trimmedCode}:${trimmedName}`;
  if (!checkRateLimit(rateLimitKey)) {
    res.status(429).json({ error: "로그인 시도가 너무 많습니다. 1분 후 다시 시도해 주세요." });
    return;
  }

  const genericAuthError = "학생 정보 또는 비밀번호가 올바르지 않습니다.";

  try {
    // 3) 학급 존재 확인
    const classDocRef = db.collection("classrooms").doc(trimmedCode);
    const classDocSnap = await classDocRef.get();

    if (!classDocSnap.exists) {
      res.status(401).json({ error: genericAuthError });
      return;
    }

    // 4) 학생 컬렉션에서 이름으로 조회
    const studentsRef = classDocRef.collection("students");
    const querySnap = await studentsRef.where("name", "==", trimmedName).get();

    if (!querySnap.empty) {
      // --- 기존 학생이 존재하는 경우 ---
      let matchedDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let matchedData: FirebaseFirestore.DocumentData | null = null;

      // 동명이인 지원: 동일한 이름을 가진 문서들 중 PIN이 일치하는 학생 탐색
      for (const docSnap of querySnap.docs) {
        const sData = docSnap.data();
        let isPinValid = false;

        if (typeof sData.pinHash === "string" && sData.pinHash) {
          isPinValid = await verifyPassword(trimmedPin, sData.pinHash);
        } else if (typeof sData.password === "string" && sData.password) {
          isPinValid = (sData.password === trimmedPin);
          if (isPinValid) {
            // 기존 평문 일치 시 점진적으로 pinHash 생성 및 마이그레이션 저장
            try {
              const newPinHash = await hashPassword(trimmedPin);
              await docSnap.ref.set({ pinHash: newPinHash }, { merge: true });
            } catch (mErr) {
              console.error("학생 PIN 해시 마이그레이션 저장 실패:", mErr instanceof Error ? mErr.message : "Error");
            }
          }
        } else {
          // password도 pinHash도 없는 상태 (교사 사전 일괄 등록 등):
          // 학생이 처음 들어와서 본인 PIN을 설정하는 케이스로 간주하고 pinHash만 안전하게 저장 (평문 password 미생성)
          isPinValid = true;
          try {
            const newPinHash = await hashPassword(trimmedPin);
            await docSnap.ref.set({ pinHash: newPinHash }, { merge: true });
          } catch (mErr) {
            console.error("신규 PIN 설정 저장 실패:", mErr instanceof Error ? mErr.message : "Error");
          }
        }

        if (isPinValid) {
          matchedDoc = docSnap;
          matchedData = sData;
          break;
        }
      }

      if (!matchedDoc || !matchedData) {
        res.status(401).json({ error: genericAuthError });
        return;
      }

      // 인증 성공 시 레이트 리밋 실패 카운트 초기화
      clearRateLimit(rateLimitKey);

      // 본인 작성 완료 내용 존재 여부 판단
      const hasStrengths = Array.isArray(matchedData.strengths) && matchedData.strengths.length > 0;
      const hasWeaknesses = Array.isArray(matchedData.weaknesses) && matchedData.weaknesses.length > 0;
      const hasSelfDesc = typeof matchedData.selfDescription === "string" && matchedData.selfDescription.trim().length > 0;
      const hasSubmittedContent = hasStrengths || hasWeaknesses || hasSelfDesc;

      // Firebase Auth Student Custom Token 발급
      const rawStudentId = matchedDoc.id;
      const uid = `student_${trimmedCode}_${rawStudentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
      const claims = {
        role: "student",
        classCode: trimmedCode,
        studentId: rawStudentId,
      };

      const customToken = await getAuth().createCustomToken(uid, claims);

      res.status(200).json({
        success: true,
        token: customToken,
        studentId: rawStudentId,
        name: trimmedName,
        isNew: false,
        hasSubmittedContent,
      });
    } else {
      // --- 학생이 존재하지 않는 경우 (신규 학생 등록: pinHash만 저장하고 plaintext password는 일절 생성하지 않음) ---
      clearRateLimit(rateLimitKey);

      const newStudentId = `student-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      const newPinHash = await hashPassword(trimmedPin);

      const newStudentData = {
        id: newStudentId,
        name: trimmedName,
        pinHash: newPinHash,
        selfDescription: "",
        strengths: [],
        weaknesses: [],
        evaluation: "",
        feedback: "",
        status: "idle",
        isFeedbackSent: false,
      };

      await studentsRef.doc(newStudentId).set(newStudentData);

      const uid = `student_${trimmedCode}_${newStudentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
      const claims = {
        role: "student",
        classCode: trimmedCode,
        studentId: newStudentId,
      };

      const customToken = await getAuth().createCustomToken(uid, claims);

      res.status(200).json({
        success: true,
        token: customToken,
        studentId: newStudentId,
        name: trimmedName,
        isNew: true,
        hasSubmittedContent: false,
      });
    }
  } catch (error) {
    console.error("학생 인증 처리 중 서버 오류 발생:", error instanceof Error ? error.message : "알 수 없는 오류");
    res.status(500).json({ error: "학생 인증 처리 중 서버 오류가 발생했습니다." });
  }
}

// 8. 토큰 검증 헬퍼 (Firebase ID Token)
async function verifyAuthToken(req: Request): Promise<{ uid: string; role?: string; classCode?: string; studentId?: string } | null> {
  const authHeader = req.headers.authorization;
  let idToken: string | undefined;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    idToken = authHeader.split("Bearer ")[1].trim();
  } else if (req.body && typeof req.body.token === "string") {
    idToken = req.body.token.trim();
  }

  if (!idToken) return null;

  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      role: decoded.role as string | undefined,
      classCode: decoded.classCode as string | undefined,
      studentId: decoded.studentId as string | undefined,
    };
  } catch {
    return null;
  }
}

// 9. 서버 전용 AI 설정 로드 (1순위: classrooms/{classCode}/secret/aiConfig, 2순위: legacy classrooms/{classCode}.apiConfig)
async function getAiConfigForClassroom(classCode: string): Promise<{
  service: string;
  apiKey?: string;
  model?: string;
  feedbackTone?: string;
  feedbackCustomInstruction?: string;
}> {
  // 1순위: server-only secret 서브문서
  try {
    const secretSnap = await db.collection("classrooms").doc(classCode).collection("secret").doc("aiConfig").get();
    if (secretSnap.exists) {
      const data = secretSnap.data();
      return {
        service: data?.service || "built-in",
        apiKey: data?.apiKey,
        model: data?.model,
        feedbackTone: data?.feedbackTone,
        feedbackCustomInstruction: data?.feedbackCustomInstruction,
      };
    }
  } catch (err) {
    console.error("secret aiConfig 조회 실패 (fallback 시도):", err instanceof Error ? err.message : "Error");
  }

  // 2순위: legacy classroom 문서 apiConfig fallback (SEC-5 전 점진적 호환)
  try {
    const classSnap = await db.collection("classrooms").doc(classCode).get();
    if (classSnap.exists) {
      const data = classSnap.data();
      if (data?.apiConfig) {
        return {
          service: data.apiConfig.service || "built-in",
          apiKey: data.apiConfig.apiKey,
          model: data.apiConfig.model,
          feedbackTone: data.apiConfig.feedbackTone,
          feedbackCustomInstruction: data.apiConfig.feedbackCustomInstruction,
        };
      }
    }
  } catch (err) {
    console.error("legacy apiConfig 조회 실패:", err instanceof Error ? err.message : "Error");
  }

  return { service: "built-in" };
}

// 10. 교사 AI 설정 저장 (POST /api/ai/config)
async function handleAiConfigSave(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "허용되지 않은 HTTP 메서드입니다." });
    return;
  }

  const authUser = await verifyAuthToken(req);
  if (!authUser) {
    res.status(401).json({ error: "인증 토큰이 유효하지 않습니다." });
    return;
  }

  const { classCode, service, apiKey, model, feedbackTone, feedbackCustomInstruction } = req.body || {};
  const trimmedCode = typeof classCode === "string" ? classCode.trim().toUpperCase() : "";

  if (!trimmedCode) {
    res.status(400).json({ error: "학급 코드가 필요합니다." });
    return;
  }

  // 교사 권한 및 본인 학급 여부 검증
  if (authUser.role !== "teacher" || authUser.classCode !== trimmedCode) {
    res.status(403).json({ error: "해당 학급의 AI 설정을 변경할 수 있는 교사 권한이 없습니다." });
    return;
  }

  try {
    const secretDocRef = db.collection("classrooms").doc(trimmedCode).collection("secret").doc("aiConfig");
    const existingSnap = await secretDocRef.get();
    const existingData = existingSnap.data();

    // API Key 처리: 새 키가 전달되면 업데이트, 빈 문자열이면 기존 키 유지 (built-in 선택 시 제거)
    let finalApiKey: string | undefined = undefined;
    if (service === "built-in") {
      finalApiKey = undefined;
    } else if (typeof apiKey === "string" && apiKey.trim()) {
      finalApiKey = apiKey.trim();
    } else if (existingData?.apiKey) {
      finalApiKey = existingData.apiKey;
    }

    const newConfigData = {
      service: service || "built-in",
      apiKey: finalApiKey,
      model: typeof model === "string" ? model.trim() : undefined,
      feedbackTone: typeof feedbackTone === "string" ? feedbackTone.trim() : undefined,
      feedbackCustomInstruction: typeof feedbackCustomInstruction === "string" ? feedbackCustomInstruction.trim() : undefined,
      updatedAt: new Date().toISOString(),
    };

    await secretDocRef.set(newConfigData, { merge: true });

    // 응답 시 apiKey 원문은 절대 노출하지 않고 hasKey 플래그만 반환
    res.status(200).json({
      success: true,
      hasKey: Boolean(finalApiKey),
      service: newConfigData.service,
      model: newConfigData.model,
      feedbackTone: newConfigData.feedbackTone,
      feedbackCustomInstruction: newConfigData.feedbackCustomInstruction,
    });
  } catch (error) {
    console.error("AI 설정 저장 중 서버 오류 발생:", error instanceof Error ? error.message : "알 수 없는 오류");
    res.status(500).json({ error: "AI 설정 저장 중 서버 오류가 발생했습니다." });
  }
}

// 11. 교사 AI 설정 조회 (GET /api/ai/config?classCode=...)
async function handleAiConfigGet(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "허용되지 않은 HTTP 메서드입니다." });
    return;
  }

  const authUser = await verifyAuthToken(req);
  if (!authUser) {
    res.status(401).json({ error: "인증 토큰이 유효하지 않습니다." });
    return;
  }

  const rawCode = req.query.code || req.query.classCode;
  const trimmedCode = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";

  if (!trimmedCode) {
    res.status(400).json({ error: "학급 코드가 필요합니다." });
    return;
  }

  if (authUser.role !== "teacher" || authUser.classCode !== trimmedCode) {
    res.status(403).json({ error: "해당 학급의 AI 설정을 조회할 권한이 없습니다." });
    return;
  }

  try {
    const config = await getAiConfigForClassroom(trimmedCode);
    res.status(200).json({
      success: true,
      hasKey: Boolean(config.apiKey),
      service: config.service,
      model: config.model,
      feedbackTone: config.feedbackTone,
      feedbackCustomInstruction: config.feedbackCustomInstruction,
    });
  } catch (error) {
    console.error("AI 설정 조회 중 서버 오류 발생:", error instanceof Error ? error.message : "알 수 없는 오류");
    res.status(500).json({ error: "AI 설정 조회 중 서버 오류가 발생했습니다." });
  }
}

// 12. AI 생성 프록시 핸들러 (POST /api/ai/consult)
async function handleAiConsult(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "허용되지 않은 HTTP 메서드입니다." });
    return;
  }

  const authUser = await verifyAuthToken(req);
  if (!authUser) {
    res.status(401).json({ error: "인증 토큰이 유효하지 않습니다." });
    return;
  }

  const { classCode, type, student } = req.body || {};
  const trimmedCode = typeof classCode === "string" ? classCode.trim().toUpperCase() : "";

  if (!trimmedCode || !type || !student) {
    res.status(400).json({ error: "필수 요청 정보(학급코드, 타입, 학생 정보)가 누락되었습니다." });
    return;
  }

  // 권한 검증: 교사이거나 본인 studentId와 일치하는 학생만 허용
  const isTeacher = authUser.role === "teacher" && authUser.classCode === trimmedCode;
  const isStudent = authUser.role === "student" && authUser.classCode === trimmedCode && authUser.studentId === student.id;

  if (!isTeacher && !isStudent) {
    res.status(403).json({ error: "해당 학급의 AI 생성 기능을 호출할 권한이 없습니다." });
    return;
  }

  try {
    const aiConfig = await getAiConfigForClassroom(trimmedCode);

    const { name, strengths, weaknesses, selfDescription } = student;
    const strengthsStr = Array.isArray(strengths)
      ? strengths.map((s: any) => `${s.trait}(${s.rating}점)`).join(", ")
      : "";
    const weaknessesStr = Array.isArray(weaknesses)
      ? weaknesses.map((w: any) => `${w.trait}(${w.rating}점)`).join(", ")
      : "";

    let prompt = "";
    let systemInstruction = "";

    if (type === "evaluation") {
      systemInstruction = "너는 학생 지도 경력이 풍부하고 따뜻한 시각을 지닌 대한민국의 노련한 초중고 학급 담임 교사야.";
      prompt = `다음 학생의 핵심 특성을 바탕으로 학교 학교생활기록부 기재용 '행동특성 및 종합의견' 평가문을 정성껏 작성해주세요.

[학생 정보]
이름: ${name || "학생"}
강점(장점): ${strengthsStr || "없음"}
약점(보완점): ${weaknessesStr || "없음"}
학생 본인의 자기평가 내용: ${selfDescription || "없음"}

[중요 작성 규칙 - 반드시 지킬 것]
1. 통지표 및 생활기록부의 모든 문장은 반드시 어미가 '~함.' 또는 '~임.'으로만 끝나야 합니다.
2. 문장이 끝나도 절대 줄을 바꾸지 말고 온점 뒤에 공백 한 칸을 두고 이어서 기록하십시오.
3. 영문 알파벳과 특수문자는 절대 기재하지 마십시오. (단위 cm, kg 등 제외)
4. 길이는 공백 포함 300자 이상 400자 이하로 하나의 긴 단락으로 작성해 주십시오.`;
    } else {
      // type === "feedback"
      systemInstruction = "너는 교실에서 늘 함께 머무는 대한민국의 다정한 담임 선생님이야. 학생이 작성한 자기평가를 읽고 따뜻한 위로와 격려 편지를 전하고 있어.";
      prompt = `선생님이 우리 반 ${name || "학생"}의 자기 성찰 일지를 읽고 마음 편지를 작성하고 있어.

[학생의 자기 평가 정보]
이름: ${name || "학생"}
선택한 나의 장점: ${strengthsStr || "없음"}
노력하고 싶은 점: ${weaknessesStr || "없음"}
자기평가: ${selfDescription || "없음"}

[편지 작성 지침]
1. 다정하고 부드러운 교사의 온기 있는 문체로 작성해줘.
2. 생활기록부, AI 같은 행정적 단어는 일절 배제해줘.
3. 300자에서 450자 안팎으로 작성해줘.`;
    }

    let generatedText = "";

    if (aiConfig.service === "custom-openai" && aiConfig.apiKey) {
      const openAiModel = aiConfig.model || "gpt-4o-mini";
      const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${aiConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openAiModel,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
        }),
      });

      if (!openAiRes.ok) {
        const errText = await openAiRes.text();
        throw new Error(`OpenAI 호출 실패 (${openAiRes.status}): ${errText}`);
      }
      const data: any = await openAiRes.json();
      generatedText = data.choices?.[0]?.message?.content?.trim() || "";
    } else {
      // Gemini 호출 (custom-gemini 또는 built-in)
      const geminiApiKey = (aiConfig.service === "custom-gemini" && aiConfig.apiKey)
        ? aiConfig.apiKey
        : process.env.GEMINI_API_KEY;

      if (!geminiApiKey) {
        throw new Error("서버에 사용 가능한 Gemini API Key가 설정되어 있지 않습니다. 우측 상단 'AI 서비스 설정'에서 개인 API Key를 등록해 주세요.");
      }

      const geminiModel = aiConfig.model || "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

      const geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { temperature: 0.7 },
        }),
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        throw new Error(`Gemini 호출 실패 (${geminiRes.status}): ${errText}`);
      }

      const data: any = await geminiRes.json();
      generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    }

    res.status(200).json({
      success: true,
      result: generatedText,
    });
  } catch (error) {
    console.error("AI 생성 중 서버 오류 발생:", error instanceof Error ? error.message : "알 수 없는 오류");
    res.status(500).json({ error: error instanceof Error ? error.message : "AI 생성 중 서버 오류가 발생했습니다." });
  }
}

// 13. Express 앱 구성
const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(cors(corsOptions));

// 엔드포인트 라우트 등록
app.get("/classroom-info", handleClassroomInfo);
app.get("/api/classroom-info", handleClassroomInfo);

app.post("/auth/teacher", handleTeacherAuth);
app.post("/api/auth/teacher", handleTeacherAuth);

app.post("/auth/student", handleStudentAuth);
app.post("/api/auth/student", handleStudentAuth);

app.post("/ai/config", handleAiConfigSave);
app.post("/api/ai/config", handleAiConfigSave);
app.get("/ai/config", handleAiConfigGet);
app.get("/api/ai/config", handleAiConfigGet);

app.post("/ai/consult", handleAiConsult);
app.post("/api/ai/consult", handleAiConsult);

// 14. Cloud Functions 2nd Gen HTTPS 엔드포인트 내보내기
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

export const studentAuth = onRequest(
  {
    region: "asia-northeast3",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
  },
  async (req, res) => {
    await handleStudentAuth(req, res);
  }
);

export const aiConfig = onRequest(
  {
    region: "asia-northeast3",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method === "POST") {
      await handleAiConfigSave(req, res);
    } else {
      await handleAiConfigGet(req, res);
    }
  }
);

export const aiConsult = onRequest(
  {
    region: "asia-northeast3",
    cors: ALLOWED_ORIGINS,
    invoker: "public",
  },
  async (req, res) => {
    await handleAiConsult(req, res);
  }
);
