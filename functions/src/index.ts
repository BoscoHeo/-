import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import express, { Request, Response } from "express";
import cors from "cors";

// 1. Firebase Admin SDK 초기화 (Application Default Credentials 활용)
// 서비스 계정 키 파일 없이 Cloud Functions 런타임 IAM 권한으로 자동 인증됩니다.
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
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};

// 3. 공통 비즈니스 로직 핸들러: classroom-info
// 학급의 존재 여부와 학급명만 안전하게 반환하며, 비밀번호/API키/학생정보는 일절 반환하지 않습니다.
async function handleClassroomInfo(req: Request, res: Response): Promise<void> {
  // GET 메서드만 허용
  if (req.method !== "GET") {
    res.status(405).json({ error: "허용되지 않은 HTTP 메서드입니다." });
    return;
  }

  const rawCode = req.query.code || req.query.classCode;

  // 1) 필수값 검증
  if (!rawCode || typeof rawCode !== "string") {
    res.status(400).json({ error: "학급 코드가 필요합니다." });
    return;
  }

  const trimmedCode = rawCode.trim().toUpperCase();

  // 2) 코드 형식 검증 (알파벳 대문자 및 숫자 4~16자리)
  // 프론트엔드 생성 형식(6자리) 및 수기 입력 최대 길이(12자리)와 100% 호환
  const CODE_REGEX = /^[A-Z0-9]{4,16}$/;
  if (!CODE_REGEX.test(trimmedCode)) {
    res.status(400).json({ error: "올바르지 않은 학급 코드 형식입니다." });
    return;
  }

  try {
    // 3) Admin SDK 단일 문서 조회 (classrooms/{classCode})
    const docSnap = await db.collection("classrooms").doc(trimmedCode).get();

    if (!docSnap.exists) {
      // 존재하지 않는 학급: HTTP 200 + exists: false 응답
      // (클라이언트 측 불필요한 네트워크 에러 바운더리 발생 방지)
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

    // 4) 민감정보 철저 배제: exists와 name 필드만 명시적으로 구성하여 반환
    // password, passwordHash, apiConfig, apiKey, 학생 데이터, PIN 등은 절대 포함하지 않음
    res.status(200).json({
      exists: true,
      name: classroomName,
    });
  } catch (error) {
    // 내부 Firestore 상세 경로, credential, stack trace 노출 차단
    console.error("classroom-info 조회 중 서버 오류 발생:", error instanceof Error ? error.message : "알 수 없는 오류");
    res.status(500).json({
      error: "학급 정보를 조회하는 중 서버 오류가 발생했습니다.",
    });
  }
}

// 4. Express 앱 구성 (향후 SEC-2, SEC-3, SEC-4 엔드포인트 확장 대비)
const app = express();
app.disable("x-powered-by");
app.use(cors(corsOptions));

// /api/classroom-info 및 /classroom-info 라우트 모두 등록
app.get("/classroom-info", handleClassroomInfo);
app.get("/api/classroom-info", handleClassroomInfo);

// 5. Cloud Functions 2nd Gen HTTPS 엔드포인트 내보내기
// 배포 리전은 한국 리전(asia-northeast3, 서울)을 기본으로 합니다.
export const api = onRequest(
  {
    region: "asia-northeast3",
    cors: false, // Express 미들웨어에서 정밀 CORS 제어 수행
    invoker: "public",
  },
  app
);

// 단일 함수 형태(classroomInfo)로도 동시에 접근 가능하도록 내보냄
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
