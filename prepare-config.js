import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'firebase-applet-config.json');

if (!fs.existsSync(filePath)) {
  const dummyConfig = {
    projectId: "",
    appId: "",
    apiKey: "",
    authDomain: "",
    firestoreDatabaseId: "",
    storageBucket: "",
    messagingSenderId: "",
    measurementId: ""
  };
  fs.writeFileSync(filePath, JSON.stringify(dummyConfig, null, 2), 'utf-8');
  console.log('Created dummy firebase-applet-config.json to prevent compilation failure.');
} else {
  console.log('firebase-applet-config.json already exists, keeping current local config.');
}
