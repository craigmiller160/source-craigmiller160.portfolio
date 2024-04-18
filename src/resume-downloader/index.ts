import path from 'path';
import { google } from 'googleapis';
import fs from 'fs/promises';
import { z } from 'zod';
import type {Resume} from '../resume/resume';

const KEYFILE_PATH = path.join(
	process.cwd(),
	'market-tracker-service-account.json'
);
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const FILE_ID = '1KNIsz3VBRhLTX9wLp8NhaeVzc1z4VMIQMDzvTK2MuNA';
const OUTPUT_DIR = path.join(
	import.meta.dirname,
	'..',
	'resume'
);
const RAW_OUTPUT_FILE = path.join(OUTPUT_DIR, 'my-resume.txt');
const PARSED_OUTPUT_FILE = path.join(OUTPUT_DIR, 'my-resume.json');

const resumeResponseSchema = z.string();

const auth = new google.auth.GoogleAuth({
	keyFile: KEYFILE_PATH,
	scopes: SCOPES
});

const drive = google.drive({
	version: 'v3',
	auth
});

const downloadResume = async () => {
	const response = await drive.files.export({
		fileId: FILE_ID,
		mimeType: 'text/plain'
	});
	const resumeText = resumeResponseSchema.parse(response.data);
	await fs.writeFile(RAW_OUTPUT_FILE, resumeText);

	const parsed = parseResume(resumeText);
	await fs.writeFile(PARSED_OUTPUT_FILE, JSON.stringify(parsed, null, 2));
};

const parseResume = (resumeText: string): Resume => {
	throw new Error();
};

downloadResume();