/**
 * SEC-5: 운영 데이터 일괄 보안 마이그레이션 도구 (MIGRATION SCRIPT)
 * 
 * - Teacher: 평문 password -> scrypt passwordHash 변환, 검증 후 평문 필드 삭제
 * - Student: 평문 password(PIN) -> scrypt pinHash 변환, 검증 후 평문 필드 삭제
 * - AI: root apiConfig.apiKey -> secret/aiConfig 이전, 검증 후 root apiKey 삭제
 * 
 * [안전 보장 규칙]
 * 1. 기본 실행 모드는 --dry-run (어떠한 쓰기/삭제도 하지 않음)
 * 2. 실제 쓰기는 명시적 --apply 플래그가 주어졌을 때만 동작
 * 3. 생성(Copy) -> 검증(Verify) -> 삭제(Delete) 3단계 엄격 적용
 * 4. 단 1건이라도 해시 검증 불일치 시 전체 실행 차단 (BLOCK)
 * 5. 민감정보(비밀번호, PIN, 키, 학생 개인정보) 콘솔 출력 일절 배제
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

// --- SEC-2/3 운영 코드와 100% 호환되는 Node.js crypto 기반 scrypt 함수 ---
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$v1$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password, combinedHash) {
  return new Promise((resolve) => {
    if (!combinedHash || typeof combinedHash !== 'string') return resolve(false);

    let salt;
    let key;

    if (combinedHash.startsWith('scrypt$v1$')) {
      const parts = combinedHash.split('$');
      if (parts.length === 4) {
        salt = parts[2];
        key = parts[3];
      }
    }

    if (!salt || !key) return resolve(false);

    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const keyBuffer = Buffer.from(key, 'hex');
        if (keyBuffer.length !== derivedKey.length) return resolve(false);
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      } catch (e) {
        resolve(false);
      }
    });
  });
}

async function runMigration(isDryRun = true) {
  console.log(`==================================================`);
  console.log(`SEC-5 Firestore Migration - [${isDryRun ? 'DRY-RUN MODE (READ ONLY)' : 'LIVE APPLY MODE'}]`);
  console.log(`Target Project: ${PROJECT_ID}`);
  console.log(`Timestamp     : ${new Date().toISOString()}`);
  console.log(`==================================================\n`);

  const stats = {
    classroomsScanned: 0,
    studentsScanned: 0,
    teacherHashesToCreate: 0,
    teacherPlaintextToDelete: 0,
    studentHashesToCreate: 0,
    studentPlaintextToDelete: 0,
    aiSecretsToMigrate: 0,
    rootApiKeysToRemove: 0,
    skippedCount: 0,
    verificationSuccessCount: 0,
    errorsCount: 0
  };

  const classroomsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/classrooms?pageSize=100`;
  const res = await requestJson(classroomsUrl);

  if (res.status !== 200 || !res.data.documents) {
    throw new Error(`Failed to fetch classrooms: ${res.status}`);
  }

  const classroomDocs = res.data.documents;
  stats.classroomsScanned = classroomDocs.length;

  const plan = {
    classrooms: [],
    students: [],
    aiConfigs: []
  };

  for (const cDoc of classroomDocs) {
    const classCode = cDoc.name.split('/').pop();
    const fields = cDoc.fields || {};

    const rawPassword = fields.password?.stringValue;
    const existingPasswordHash = fields.passwordHash?.stringValue;
    const rawApiConfig = fields.apiConfig?.mapValue?.fields;
    const rawApiKey = rawApiConfig?.apiKey?.stringValue;

    // --- 1. Teacher Password Logic ---
    if (rawPassword) {
      if (!existingPasswordHash) {
        // Type C: Create new hash and verify
        const newHash = await hashPassword(rawPassword);
        const isValid = await verifyPassword(rawPassword, newHash);
        if (isValid) {
          stats.teacherHashesToCreate++;
          stats.teacherPlaintextToDelete++;
          stats.verificationSuccessCount++;
          plan.classrooms.push({
            type: 'CREATE_AND_DELETE',
            classCode,
            docName: cDoc.name,
            newHash,
            existingFields: fields
          });
        } else {
          stats.errorsCount++;
          console.error(`[ERROR] Teacher password hash verification failed for classroom: ${classCode}`);
        }
      } else {
        // Type A: Existing hash present, verify against raw password
        const isMatch = await verifyPassword(rawPassword, existingPasswordHash);
        if (isMatch) {
          stats.teacherPlaintextToDelete++;
          stats.verificationSuccessCount++;
          plan.classrooms.push({
            type: 'DELETE_ONLY',
            classCode,
            docName: cDoc.name,
            existingFields: fields
          });
        } else {
          stats.errorsCount++;
          console.error(`[CRITICAL ERROR] Existing teacher passwordHash mismatch with plaintext password for classroom: ${classCode}`);
        }
      }
    } else {
      stats.skippedCount++;
    }

    // --- 2. AI Config Logic ---
    const secretUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/classrooms/${classCode}/secret/aiConfig`;
    const secretRes = await requestJson(secretUrl);
    const secretExists = secretRes.status === 200 && secretRes.data.name;

    if (rawApiKey) {
      if (!secretExists) {
        // Type A: Migrate to secret/aiConfig
        stats.aiSecretsToMigrate++;
        stats.rootApiKeysToRemove++;
        stats.verificationSuccessCount++;
        plan.aiConfigs.push({
          type: 'MIGRATE_SECRET_AND_DELETE_ROOT',
          classCode,
          apiKey: rawApiKey,
          model: rawApiConfig?.model?.stringValue || '',
          provider: rawApiConfig?.provider?.stringValue || '',
          docName: cDoc.name,
          existingFields: fields
        });
      } else {
        // Type B: Compare with secret
        const secretApiKey = secretRes.data.fields?.apiKey?.stringValue;
        if (secretApiKey === rawApiKey) {
          stats.rootApiKeysToRemove++;
          stats.verificationSuccessCount++;
          plan.aiConfigs.push({
            type: 'DELETE_ROOT_ONLY',
            classCode,
            docName: cDoc.name,
            existingFields: fields
          });
        } else {
          stats.errorsCount++;
          console.error(`[ERROR] Root apiKey does not match secret/aiConfig apiKey for classroom: ${classCode}`);
        }
      }
    }

    // --- 3. Students Subcollection Logic ---
    const studentsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/classrooms/${classCode}/students?pageSize=100`;
    const studentsRes = await requestJson(studentsUrl);

    if (studentsRes.status === 200 && Array.isArray(studentsRes.data.documents)) {
      for (const sDoc of studentsRes.data.documents) {
        stats.studentsScanned++;
        const sFields = sDoc.fields || {};
        const rawPin = sFields.password?.stringValue;
        const existingPinHash = sFields.pinHash?.stringValue;

        if (rawPin) {
          if (!existingPinHash) {
            // Type C: Create new pinHash and verify
            const newPinHash = await hashPassword(rawPin);
            const isValid = await verifyPassword(rawPin, newPinHash);
            if (isValid) {
              stats.studentHashesToCreate++;
              stats.studentPlaintextToDelete++;
              stats.verificationSuccessCount++;
              plan.students.push({
                type: 'CREATE_AND_DELETE',
                docName: sDoc.name,
                newPinHash,
                existingFields: sFields
              });
            } else {
              stats.errorsCount++;
              console.error(`[ERROR] Student PIN hash verification failed in classroom: ${classCode}`);
            }
          } else {
            // Type A: Existing pinHash present, verify
            const isMatch = await verifyPassword(rawPin, existingPinHash);
            if (isMatch) {
              stats.studentPlaintextToDelete++;
              stats.verificationSuccessCount++;
              plan.students.push({
                type: 'DELETE_ONLY',
                docName: sDoc.name,
                existingFields: sFields
              });
            } else {
              stats.errorsCount++;
              console.error(`[CRITICAL ERROR] Student pinHash mismatch with plaintext in classroom: ${classCode}`);
            }
          }
        } else {
          // Type D: placeholder without PIN
          stats.skippedCount++;
        }
      }
    }
  }

  // --- Display Audit & Plan Summary ---
  console.log('--- SEC-5 Migration Operations Summary ---');
  console.log(`Classrooms Scanned           : ${stats.classroomsScanned}`);
  console.log(`Students Scanned             : ${stats.studentsScanned}`);
  console.log(`Teacher Hashes to Create     : ${stats.teacherHashesToCreate}`);
  console.log(`Teacher Plaintext to Delete  : ${stats.teacherPlaintextToDelete}`);
  console.log(`Student Hashes to Create     : ${stats.studentHashesToCreate}`);
  console.log(`Student Plaintext to Delete  : ${stats.studentPlaintextToDelete}`);
  console.log(`AI Secrets to Migrate        : ${stats.aiSecretsToMigrate}`);
  console.log(`Root API Keys to Remove      : ${stats.rootApiKeysToRemove}`);
  console.log(`Skipped Items (Placeholders) : ${stats.skippedCount}`);
  console.log(`Verification Checks Passed   : ${stats.verificationSuccessCount}`);
  console.log(`Errors / Mismatches Detected : ${stats.errorsCount}`);
  console.log('-------------------------------------------\n');

  if (stats.errorsCount > 0) {
    console.error(`[CRITICAL BLOCK] Found ${stats.errorsCount} validation errors. Migration execution is BLOCKED.`);
    process.exit(1);
  }

  if (isDryRun) {
    console.log('[DRY-RUN COMPLETE] All verification checks passed with 0 errors.');
    console.log('[DRY-RUN COMPLETE] Zero (0) write or delete operations were performed on Firestore.');
    console.log('[DRY-RUN COMPLETE] Ready for live migration when authorized with --apply.\n');
    return stats;
  }

  // --- LIVE APPLY EXECUTION (Only executed when isDryRun === false) ---
  console.log('>>> [LIVE APPLY] Executing migration on production Firestore...\n');

  let writeCount = 0;
  let deleteCount = 0;

  // STEP 1: AI Configs Migration (Secret creation -> Verification -> Root key removal)
  console.log('[APPLY STEP 1/3] Migrating AI Configs to secret/aiConfig...');
  for (const ai of plan.aiConfigs) {
    if (ai.type === 'MIGRATE_SECRET_AND_DELETE_ROOT') {
      const secretUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/classrooms/${ai.classCode}/secret/aiConfig`;
      const secretPayload = {
        fields: {
          apiKey: { stringValue: ai.apiKey },
          provider: { stringValue: ai.provider || 'gemini' },
          model: { stringValue: ai.model || 'gemini-2.5-flash' },
          updatedAt: { stringValue: new Date().toISOString() }
        }
      };

      // 1-1. Write secret document
      const writeRes = await requestJson(secretUrl, {
        method: 'PATCH',
        body: secretPayload
      });
      if (writeRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to create secret/aiConfig for classroom: ${ai.classCode} (status: ${writeRes.status})`);
      }
      writeCount++;

      // 1-2. Read-back verification
      const verifyRes = await requestJson(secretUrl);
      if (verifyRes.status !== 200 || verifyRes.data.fields?.apiKey?.stringValue !== ai.apiKey) {
        throw new Error(`[CRITICAL] Secret verification failed after write for classroom: ${ai.classCode}`);
      }

      // 1-3. Sanitize root apiConfig (remove apiKey, preserve provider/model/hasKey)
      const sanitizedRootApiConfig = {
        hasKey: { booleanValue: true },
        provider: { stringValue: ai.provider || 'gemini' },
        model: { stringValue: ai.model || 'gemini-2.5-flash' }
      };
      const rootPatchUrl = `https://firestore.googleapis.com/v1/${ai.docName}?updateMask.fieldPaths=apiConfig`;
      const rootPatchRes = await requestJson(rootPatchUrl, {
        method: 'PATCH',
        body: {
          fields: {
            apiConfig: { mapValue: { fields: sanitizedRootApiConfig } }
          }
        }
      });
      if (rootPatchRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to sanitize root apiConfig for classroom: ${ai.classCode}`);
      }
      deleteCount++;
      console.log(`  [AI OK] Successfully migrated secret and sanitized root apiConfig for: ${ai.classCode}`);
    } else if (ai.type === 'DELETE_ROOT_ONLY') {
      // Secret already exists and matched, just sanitize root
      const sanitizedRootApiConfig = {
        hasKey: { booleanValue: true },
        provider: { stringValue: ai.provider || 'gemini' },
        model: { stringValue: ai.model || 'gemini-2.5-flash' }
      };
      const rootPatchUrl = `https://firestore.googleapis.com/v1/${ai.docName}?updateMask.fieldPaths=apiConfig`;
      const rootPatchRes = await requestJson(rootPatchUrl, {
        method: 'PATCH',
        body: {
          fields: {
            apiConfig: { mapValue: { fields: sanitizedRootApiConfig } }
          }
        }
      });
      if (rootPatchRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to sanitize root apiConfig for classroom: ${ai.classCode}`);
      }
      deleteCount++;
      console.log(`  [AI OK] Sanitized root apiConfig for: ${ai.classCode}`);
    }
  }

  // STEP 2: Teacher Passwords Migration
  console.log('\n[APPLY STEP 2/3] Migrating Teacher passwords to passwordHash...');
  for (const t of plan.classrooms) {
    if (t.type === 'CREATE_AND_DELETE') {
      // 2-1. Write passwordHash
      const patchHashUrl = `https://firestore.googleapis.com/v1/${t.docName}?updateMask.fieldPaths=passwordHash`;
      const patchHashRes = await requestJson(patchHashUrl, {
        method: 'PATCH',
        body: {
          fields: { passwordHash: { stringValue: t.newHash } }
        }
      });
      if (patchHashRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to write passwordHash for classroom: ${t.classCode}`);
      }
      writeCount++;

      // 2-2. Read-back verification
      const verifyRes = await requestJson(`https://firestore.googleapis.com/v1/${t.docName}`);
      const savedHash = verifyRes.data.fields?.passwordHash?.stringValue;
      if (savedHash !== t.newHash) {
        throw new Error(`[CRITICAL] passwordHash read-back mismatch for classroom: ${t.classCode}`);
      }

      // 2-3. Delete legacy plaintext password
      const deleteUrl = `https://firestore.googleapis.com/v1/${t.docName}?updateMask.fieldPaths=password`;
      const deleteRes = await requestJson(deleteUrl, {
        method: 'PATCH',
        body: { fields: {} }
      });
      if (deleteRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to delete legacy password for classroom: ${t.classCode}`);
      }
      deleteCount++;
      console.log(`  [TEACHER OK] Created hash and removed plaintext password for: ${t.classCode}`);
    } else if (t.type === 'DELETE_ONLY') {
      // Hash already exists and verified, delete legacy password
      const deleteUrl = `https://firestore.googleapis.com/v1/${t.docName}?updateMask.fieldPaths=password`;
      const deleteRes = await requestJson(deleteUrl, {
        method: 'PATCH',
        body: { fields: {} }
      });
      if (deleteRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to delete legacy password for classroom: ${t.classCode}`);
      }
      deleteCount++;
      console.log(`  [TEACHER OK] Removed plaintext password (hash already verified) for: ${t.classCode}`);
    }
  }

  // STEP 3: Student PINs Migration
  console.log('\n[APPLY STEP 3/3] Migrating Student PINs to pinHash...');
  let studentSuccessCount = 0;
  for (const s of plan.students) {
    if (s.type === 'CREATE_AND_DELETE') {
      // 3-1. Write pinHash
      const patchHashUrl = `https://firestore.googleapis.com/v1/${s.docName}?updateMask.fieldPaths=pinHash`;
      const patchHashRes = await requestJson(patchHashUrl, {
        method: 'PATCH',
        body: {
          fields: { pinHash: { stringValue: s.newPinHash } }
        }
      });
      if (patchHashRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to write pinHash for student in doc: ${s.docName}`);
      }
      writeCount++;

      // 3-2. Read-back verification
      const verifyRes = await requestJson(`https://firestore.googleapis.com/v1/${s.docName}`);
      const savedPinHash = verifyRes.data.fields?.pinHash?.stringValue;
      if (savedPinHash !== s.newPinHash) {
        throw new Error(`[CRITICAL] pinHash read-back mismatch for student in doc: ${s.docName}`);
      }

      // 3-3. Delete legacy plaintext password (PIN)
      const deleteUrl = `https://firestore.googleapis.com/v1/${s.docName}?updateMask.fieldPaths=password`;
      const deleteRes = await requestJson(deleteUrl, {
        method: 'PATCH',
        body: { fields: {} }
      });
      if (deleteRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to delete legacy password for student in doc: ${s.docName}`);
      }
      deleteCount++;
      studentSuccessCount++;
    } else if (s.type === 'DELETE_ONLY') {
      // Hash already exists and verified, delete legacy password
      const deleteUrl = `https://firestore.googleapis.com/v1/${s.docName}?updateMask.fieldPaths=password`;
      const deleteRes = await requestJson(deleteUrl, {
        method: 'PATCH',
        body: { fields: {} }
      });
      if (deleteRes.status !== 200) {
        throw new Error(`[CRITICAL] Failed to delete legacy password for student in doc: ${s.docName}`);
      }
      deleteCount++;
      studentSuccessCount++;
    }
  }
  console.log(`  [STUDENTS OK] Migrated and sanitized ${studentSuccessCount} students successfully.`);

  console.log('\n==================================================');
  console.log('[LIVE APPLY COMPLETED SUCCESSFULLY]');
  console.log(`Total Write Operations : ${writeCount}`);
  console.log(`Total Delete Operations: ${deleteCount}`);
  console.log('==================================================\n');

  return { ...stats, writeCount, deleteCount };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = !isApply || args.includes('--dry-run');

  runMigration(isDryRun).catch(err => {
    console.error('[MIGRATION EXECUTION FAILED]:', err.message);
    process.exit(1);
  });
}

module.exports = { runMigration, hashPassword, verifyPassword };
