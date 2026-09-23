/**
 * SEC-5: 운영 데이터 비상 롤백 및 복원 도구 (RESTORE TOOL)
 * 
 * - .backup/ 디렉터리의 지정된 스냅샷 JSON 파일을 읽어 원본 상태로 복원
 * - 안전 장치: --confirm 플래그가 명시되지 않으면 절대 쓰기/삭제를 수행하지 않음
 * - 원본 스냅샷에 없던 secret/aiConfig 문서는 원래 상태대로 삭제 처리
 * 
 * [주의] 이번 단계에서는 스크립트 작성만 수행하며, 실제 실행은 일절 하지 않습니다.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

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

async function restoreSnapshot(snapshotFilePath, isDryRun = true) {
  if (!fs.existsSync(snapshotFilePath)) {
    throw new Error(`Snapshot file not found: ${snapshotFilePath}`);
  }

  const raw = fs.readFileSync(snapshotFilePath, 'utf8');
  const snapshot = JSON.parse(raw);

  console.log(`[RESTORE] Snapshot Loaded: ${snapshotFilePath}`);
  console.log(`[RESTORE] CreatedAt: ${snapshot.metadata?.createdAt}, Project: ${snapshot.metadata?.firebaseProject}`);
  console.log(`[RESTORE] Target Classrooms: ${snapshot.classrooms?.length}, Total Students: ${snapshot.metadata?.studentCount}`);

  if (isDryRun) {
    console.log('[RESTORE DRY-RUN] Simulation only. No changes were made to production Firestore.');
    console.log('[RESTORE DRY-RUN] To execute real restore, pass --confirm and snapshot file path explicitly.');
    return;
  }

  // --- Real Restore Execution (Only when --confirm is explicitly passed) ---
  console.log('[RESTORE ACTIVE] Restoring documents to production Firestore...');

  for (const cEntry of snapshot.classrooms) {
    const classCode = cEntry.classCode;
    console.log(`[RESTORE] Restoring classroom: ${classCode}`);

    // 1. Restore root classroom document
    if (cEntry.document?.fields) {
      const docUrl = `https://firestore.googleapis.com/v1/${cEntry.document.name}`;
      await requestJson(docUrl, {
        method: 'PATCH',
        body: { fields: cEntry.document.fields }
      });
    }

    // 2. Restore secret/aiConfig
    const secretDocUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/classrooms/${classCode}/secret/aiConfig`;
    if (cEntry.secretAiConfig?.fields) {
      await requestJson(secretDocUrl, {
        method: 'PATCH',
        body: { fields: cEntry.secretAiConfig.fields }
      });
    } else {
      // Originally did not exist -> delete if created
      await requestJson(secretDocUrl, { method: 'DELETE' });
    }

    // 3. Restore all students
    for (const sEntry of (cEntry.students || [])) {
      if (sEntry.document?.fields) {
        const studentUrl = `https://firestore.googleapis.com/v1/${sEntry.document.name}`;
        await requestJson(studentUrl, {
          method: 'PATCH',
          body: { fields: sEntry.document.fields }
        });
      }
    }
  }

  console.log('[RESTORE COMPLETED] All documents have been restored to snapshot state.');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const isConfirm = args.includes('--confirm');
  const fileArg = args.find(a => !a.startsWith('--'));

  if (!isConfirm) {
    console.warn('SAFETY LOCK: You must provide --confirm to perform actual restore.');
    console.warn('Usage: node scripts/sec5_restore.cjs <snapshot_file.json> --confirm');
    process.exit(1);
  }

  if (!fileArg) {
    console.error('Error: Snapshot file path must be specified.');
    process.exit(1);
  }

  restoreSnapshot(path.resolve(process.cwd(), fileArg), !isConfirm).catch(err => {
    console.error('[RESTORE FAILED]:', err.message);
    process.exit(1);
  });
}

module.exports = { restoreSnapshot };
