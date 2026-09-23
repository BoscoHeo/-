/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { AIServiceConfig } from './types';

const rawConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string) || firebaseConfig.apiKey,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || firebaseConfig.authDomain,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || firebaseConfig.projectId,
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || firebaseConfig.storageBucket,
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || firebaseConfig.messagingSenderId,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || firebaseConfig.appId,
  measurementId: (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string) || firebaseConfig.measurementId,
  firestoreDatabaseId: (import.meta.env.VITE_FIREBASE_DATABASE_ID as string) || firebaseConfig.firestoreDatabaseId
};

const BEHAVIOR_OFFICIAL_FIREBASE_API_KEY = "AIzaSyCjxgGh1tdQA91GXlJFFS6RU_dHp0ldMgw";

function sanitizeFirebaseApiKey(key?: string): string {
  if (!key || key === "AIzaSyDummyKeyForInitializationOnly") {
    return BEHAVIOR_OFFICIAL_FIREBASE_API_KEY;
  }
  // Cloudflare Pages 환경 변수에 등록된 대문자 'L' 오타(GXL)를 정상 소문자 'l'(GXl)로 자동 보정
  if (key.includes("91GXLJFF") || key === "AIzaSyCjxgGh1tdQA91GXLJFFS6RU_dHp0ldMgw") {
    return BEHAVIOR_OFFICIAL_FIREBASE_API_KEY;
  }
  return key;
}

// Fallback config if environment variables or config JSON are missing/empty
const config = {
  apiKey: sanitizeFirebaseApiKey(rawConfig.apiKey),
  authDomain: rawConfig.authDomain || "behavior-77e8e.firebaseapp.com",
  projectId: rawConfig.projectId || "behavior-77e8e",
  storageBucket: rawConfig.storageBucket || "behavior-77e8e.firebasestorage.app",
  messagingSenderId: rawConfig.messagingSenderId || "434754954924",
  appId: rawConfig.appId || "1:434754954924:web:a741077b8e1c6954dfa109",
  measurementId: rawConfig.measurementId || "G-CV3LGNC4WF",
  firestoreDatabaseId: rawConfig.firestoreDatabaseId || ""
};

const app = initializeApp(config);
export const db = getFirestore(app, config.firestoreDatabaseId || undefined);
export const auth = getAuth();
export const googleProvider = new GoogleAuthProvider();

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Google 로그인 중 에러가 발생했습니다: ", error);
    throw error;
  }
}

export function getApiBaseUrl(): string {
  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  return (import.meta.env.VITE_API_BASE_URL as string) ||
    (import.meta.env.VITE_FUNCTIONS_URL as string) ||
    (isLocal
      ? 'http://127.0.0.1:5001/behavior-77e8e/asia-northeast3/api'
      : 'https://asia-northeast3-behavior-77e8e.cloudfunctions.net/api');
}

export async function createClassroomWithServer(
  name: string,
  password: string
): Promise<{ success: boolean; classCode: string; name: string }> {
  const base = getApiBaseUrl();

  const res = await fetch(`${base}/classroom/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token || !data.classCode) {
    throw new Error(data.error || '학급 개설에 실패했습니다.');
  }

  // 발급받은 Teacher Custom Token으로 Firebase Auth 세션 즉시 수립
  await signInWithCustomToken(auth, data.token);

  return {
    success: true,
    classCode: data.classCode,
    name: data.name || name,
  };
}

export async function getClassroomInfo(classCode: string): Promise<{ exists: boolean; name?: string }> {
  const base = getApiBaseUrl();
  const trimmed = classCode.trim().toUpperCase();
  const res = await fetch(`${base}/classroom-info?code=${encodeURIComponent(trimmed)}`);
  if (!res.ok) {
    throw new Error('학급 기본 정보를 불러오지 못했습니다.');
  }
  return res.json();
}

export async function loginTeacherWithServer(
  classCode: string,
  password: string
): Promise<{ success: boolean; name: string }> {
  const base = getApiBaseUrl();

  const res = await fetch(`${base}/auth/teacher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classCode, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(data.error || '교사 인증에 실패했습니다.');
  }

  await signInWithCustomToken(auth, data.token);

  return {
    success: true,
    name: data.name || '우리 학급',
  };
}

export async function logoutTeacher(): Promise<void> {
  await signOut(auth);
}

export async function loginStudentWithServer(
  classCode: string,
  name: string,
  pin: string
): Promise<{
  success: boolean;
  studentId: string;
  name: string;
  isNew: boolean;
  hasSubmittedContent: boolean;
}> {
  const base = getApiBaseUrl();

  const res = await fetch(`${base}/auth/student`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classCode, name, pin }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(data.error || '학생 인증에 실패했습니다.');
  }

  await signInWithCustomToken(auth, data.token);

  return {
    success: true,
    studentId: data.studentId,
    name: data.name || name,
    isNew: Boolean(data.isNew),
    hasSubmittedContent: Boolean(data.hasSubmittedContent),
  };
}

export async function logoutStudent(): Promise<void> {
  await signOut(auth);
}

export async function saveAiConfigWithServer(
  classCode: string,
  config: {
    service: 'built-in' | 'custom-gemini' | 'custom-openai';
    apiKey?: string;
    model?: string;
    feedbackTone?: string;
    feedbackCustomInstruction?: string;
  }
): Promise<{ success: boolean; hasKey: boolean; service: string; model?: string }> {
  const base = getApiBaseUrl();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('교사 인증 세션이 필요합니다.');
  const idToken = await currentUser.getIdToken();

  const res = await fetch(`${base}/ai/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ classCode, ...config }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'AI 설정 저장에 실패했습니다.');
  return data;
}

export async function getAiConfigWithServer(
  classCode: string
): Promise<AIServiceConfig> {
  const base = getApiBaseUrl();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('교사 인증 세션이 필요합니다.');
  const idToken = await currentUser.getIdToken();

  const res = await fetch(`${base}/ai/config?classCode=${encodeURIComponent(classCode.trim().toUpperCase())}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'AI 설정을 불러오지 못했습니다.');
  return data;
}

export async function callAiConsultWithServer(params: {
  classCode: string;
  type: 'evaluation' | 'feedback';
  student: {
    id: string;
    name: string;
    strengths: any[];
    weaknesses: any[];
    selfDescription?: string;
  };
}): Promise<string> {
  const base = getApiBaseUrl();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('인증 세션이 필요합니다. 다시 로그인해 주세요.');
  const idToken = await currentUser.getIdToken();

  const res = await fetch(`${base}/ai/consult`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.result) {
    throw new Error(data.error || 'AI 생성에 실패했습니다.');
  }
  return data.result;
}

export { signInWithCustomToken, signOut };

// Error-Handling Interface from Firebase Integration Skill
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const isFirebaseConfigured = Boolean(
  rawConfig.apiKey &&
  rawConfig.projectId &&
  rawConfig.apiKey !== "AIzaSyDummyKeyForInitializationOnly" &&
  rawConfig.projectId !== "dummy-project"
);

async function testConnection() {
  if (!isFirebaseConfigured) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Firestore connection check: Client is offline or Firebase project unreachable.");
    }
  }
}

testConnection();
