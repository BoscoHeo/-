/**
 * SEC-5: 운영 Firestore 데이터 비파괴 백업 도구 (READ ONLY)
 * 
 * - classrooms 루트 문서, students 하위 문서, secret/aiConfig 문서 스냅샷 수집
 * - .backup/sec5_pre_migration_YYYYMMDD_HHMMSS.json 으로 저장
 * - 민감 데이터(비밀번호, PIN, API Key 등)는 파일에만 완전 보존하며 콘솔/로그에는 일체 출력하지 않음
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const PROJECT_ID = 'behavior-77e8e';
const CONFIG_PATH = 'C:/Users/User/.config/configstore/firebase-tools.json';

function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return config.tokens?.access_token;
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      timeout: 10000
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// Firestore REST format Document -> Clean JS Object with raw fields preserved
function parseFirestoreDoc(doc) {
  if (!doc) return null;
  return {
    name: doc.name,
    createTime: doc.createTime,
    updateTime: doc.updateTime,
    fields: doc.fields || {}
  };
}

async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
  const backupDir = path.resolve(__dirname, '..', '.backup');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFilePath = path.join(backupDir, `sec5_pre_migration_${timestamp}.json`);

  console.log('[1/4] Connecting to Firestore and fetching classrooms collection...');
  const classroomsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/classrooms?pageSize=100`;
  const classroomsRes = await requestJson(classroomsUrl);

  if (classroomsRes.status !== 200 || !classroomsRes.data.documents) {
    throw new Error(`Failed to list classrooms: status ${classroomsRes.status}`);
  }

  const classroomDocs = classroomsRes.data.documents;
  const snapshotData = {
    metadata: {
      snapshotVersion: '1.0.0',
      createdAt: new Date().toISOString(),
      firebaseProject: PROJECT_ID,
      classroomCount: classroomDocs.length,
      studentCount: 0
    },
    classrooms: []
  };

  console.log(`[2/4] Scanned ${classroomDocs.length} classrooms. Fetching subcollections...`);

  let totalStudents = 0;

  for (const cDoc of classroomDocs) {
    const classCode = cDoc.name.split('/').pop();
    const classroomEntry = {
      classCode,
      document: parseFirestoreDoc(cDoc),
      secretAiConfig: null,
      students: []
    };

    // 1. Fetch secret/aiConfig if exists
    const secretUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/classrooms/${classCode}/secret/aiConfig`;
    const secretRes = await requestJson(secretUrl);
    if (secretRes.status === 200 && secretRes.data.name) {
      classroomEntry.secretAiConfig = parseFirestoreDoc(secretRes.data);
    }

    // 2. Fetch all students in classrooms/{classCode}/students
    const studentsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/classrooms/${classCode}/students?pageSize=100`;
    const studentsRes = await requestJson(studentsUrl);

    if (studentsRes.status === 200 && Array.isArray(studentsRes.data.documents)) {
      for (const sDoc of studentsRes.data.documents) {
        const studentId = sDoc.name.split('/').pop();
        classroomEntry.students.push({
          studentId,
          document: parseFirestoreDoc(sDoc)
        });
        totalStudents++;
      }
    }

    snapshotData.classrooms.push(classroomEntry);
  }

  snapshotData.metadata.studentCount = totalStudents;

  console.log(`[3/4] Serializing and writing snapshot to disk...`);
  const jsonString = JSON.stringify(snapshotData, null, 2);
  fs.writeFileSync(backupFilePath, jsonString, 'utf8');

  // Compute SHA-256 hash for integrity verification
  const hash = crypto.createHash('sha256').update(jsonString, 'utf8').digest('hex');

  console.log(`[4/4] Backup completed successfully.`);
  console.log('--- Backup Verification Summary ---');
  console.log(`File Path       : ${backupFilePath}`);
  console.log(`File Size       : ${jsonString.length} bytes`);
  console.log(`Classrooms      : ${snapshotData.metadata.classroomCount}`);
  console.log(`Total Students  : ${snapshotData.metadata.studentCount}`);
  console.log(`SHA-256 Hash    : ${hash}`);
  console.log('-----------------------------------');

  return {
    filePath: backupFilePath,
    hash,
    classroomCount: snapshotData.metadata.classroomCount,
    studentCount: snapshotData.metadata.studentCount
  };
}

if (require.main === module) {
  runBackup().catch(err => {
    console.error('Backup failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runBackup };
