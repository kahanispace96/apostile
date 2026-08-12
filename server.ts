/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import jwt from 'jsonwebtoken';
import { dbService } from './server/db';
import { createServer as createViteServer } from 'vite';
import { Certificate } from './src/types';

// Extend Express Request type to include auth data
interface AuthenticatedRequest extends Request {
  user?: {
    username: string;
  };
}

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bd-e-apostille-secret-key-2026-mofa';

// Increase payload limits for uploading base64 signatures/seals
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Admin authentication middleware
const authenticateAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authorization token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { username: string };
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ success: false, message: 'Invalid or expired session token' });
    return;
  }
};

// Optional admin authentication middleware (allows registration calls with or without bearer token)
const optionalAdminAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { username: string };
      req.user = decoded;
    } catch (err) {
      res.status(403).json({ success: false, message: 'Invalid or expired session token' });
      return;
    }
  }
  next();
};

// ==========================================
// API ENDPOINTS
// ==========================================

// Auth Login
app.post(['/api/auth/login', '/auth/login'], (req: Request, res: Response) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required' });
      return;
    }

    const normalizedUsername = String(username).trim();
    const normalizedPassword = String(password);

    const isValid = dbService.verifyAdminPassword(normalizedPassword);
    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid admin credentials. Please check your password.' });
      return;
    }

    // Sign token valid for 24 hours
    const token = jwt.sign({ username: normalizedUsername }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      success: true,
      token,
      username: normalizedUsername,
      message: 'Login successful'
    });
  } catch (err: any) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ success: false, message: 'Authentication service temporarily unavailable. Please try again.' });
  }
});

// Verify Current Token Validity
app.get(['/api/auth/verify-token', '/auth/verify-token'], (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.json({ valid: false });
    return;
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { username: string };
    res.json({ valid: true, username: decoded.username || 'admin' });
  } catch (err) {
    res.json({ valid: false });
  }
});

// PUBLIC: Verify Certificate by Unique ID
app.get([
  '/api/certificates/verify/:id',
  '/certificates/verify/:id',
  '/api/verify/:id',
  '/verify/:id'
], async (req: Request, res: Response, next: NextFunction) => {
  // If the browser is requesting HTML for page navigation (e.g. /verify/APO-2026-0810-76402), let Vite/SPA handle it
  if (req.path.startsWith('/verify/') && !req.path.startsWith('/api/') && req.accepts('html') && !req.xhr && req.headers.accept?.includes('text/html')) {
    return next();
  }

  const id = req.params.id;
  const certificate = await dbService.getCertificateById(id);

  if (!certificate) {
    res.status(404).json({ success: false, message: '✗ Invalid Certificate: No matching record found.' });
    return;
  }

  res.json({
    success: true,
    message: '✓ Verified Certificate',
    certificate,
    customDomain: dbService.getSettings()?.customDomain || ''
  });
});

// PUBLIC: Get list of active certificate IDs for navigation/testing purposes
app.get(['/api/public/certificates', '/public/certificates'], (req: Request, res: Response) => {
  const certificates = dbService.getCertificates();
  res.json({
    success: true,
    certificates: certificates.map(c => ({ id: c.id, applicantName: c.applicantName }))
  });
});

// PUBLIC: Verify Certificate / Token / Tracking ID / Roll by ID or Query Parameters
app.get([
  '/api/certificates/verify/:id',
  '/api/certificates/verify',
  '/api/verify/:id',
  '/api/verify'
], async (req: Request, res: Response) => {
  const queryId = req.query.id || req.query.token || req.query.verify || req.query.trackingNumber;
  const queryRoll = req.query.roll || req.query.rollNumber;
  const queryReg = req.query.reg || req.query.registrationNumber;

  const id = (req.params.id || queryId || queryRoll || '').toString();
  if (!id && !queryRoll) {
    res.status(400).json({ success: false, message: 'Verification ID or Roll number is required' });
    return;
  }

  const certificate = await dbService.getCertificateById(
    id,
    queryRoll ? queryRoll.toString() : undefined,
    queryReg ? queryReg.toString() : undefined
  );
  const settings = dbService.getSettings();

  if (certificate) {
    res.json({
      success: true,
      certificate,
      customDomain: settings.customDomain || ''
    });
    return;
  }

  res.status(404).json({
    success: false,
    message: `No matching verification record was found for Token / ID "${id}".`
  });
});

// ADMIN: Get all certificates (with optional search query)
app.get(['/api/certificates', '/certificates'], authenticateAdmin, (req: AuthenticatedRequest, res: Response) => {
  const searchQuery = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
  const certificates = dbService.getCertificates();

  if (!searchQuery) {
    res.json({ success: true, certificates });
    return;
  }

  // Safe client-side structured filtering to prevent any query leakage or parsing error
  const filtered = certificates.filter(cert => {
    return (
      cert.id.toLowerCase().includes(searchQuery) ||
      cert.applicantName.toLowerCase().includes(searchQuery) ||
      (cert.fatherName && cert.fatherName.toLowerCase().includes(searchQuery)) ||
      cert.certificateType.toLowerCase().includes(searchQuery) ||
      (cert.boardName && cert.boardName.toLowerCase().includes(searchQuery)) ||
      (cert.certificateNumber && cert.certificateNumber.toLowerCase().includes(searchQuery))
    );
  });

  res.json({ success: true, certificates: filtered });
});

// REGISTER / CREATE CERTIFICATE (Handles multiple endpoint aliases)
const handleRegistration = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = req.body || {};

    const name = data.applicantName || data.candidateName || data.name || data.username;
    if (!name || String(name).trim() === '') {
      res.status(400).json({ success: false, message: 'Candidate Name (applicantName) is required.' });
      return;
    }

    // Auto-generate unique verification ID if none supplied
    let verificationId = data.id || data.verificationId || data.token || data.certificateNumber;
    verificationId = verificationId ? String(verificationId).trim().toUpperCase() : '';

    if (!verificationId) {
      let attempts = 0;
      do {
        const stamp = Math.floor(10000 + Math.random() * 90000);
        const year = data.issueDate ? new Date(data.issueDate).getFullYear() : new Date().getFullYear();
        verificationId = `BD-AP-${year}-${stamp}`;
        attempts++;
      } while ((await dbService.getCertificateById(verificationId)) && attempts < 25);
    } else {
      // If custom ID already exists in DB, seamlessly update it with new fields & attachedCertificates
      const existing = await dbService.getCertificateById(verificationId);
      if (existing) {
        const updatePayload: Partial<Certificate> = {
          applicantName: String(name).trim().toUpperCase(),
          fatherName: data.fatherName ? String(data.fatherName).trim().toUpperCase() : existing.fatherName,
          motherName: data.motherName ? String(data.motherName).trim().toUpperCase() : existing.motherName,
          dob: data.dob ? String(data.dob) : existing.dob,
          certificateType: data.certificateType ? String(data.certificateType) : existing.certificateType,
          examinationName: data.examinationName ? String(data.examinationName).trim() : existing.examinationName,
          rollNumber: data.rollNumber ? String(data.rollNumber).trim() : existing.rollNumber,
          registrationNumber: data.registrationNumber ? String(data.registrationNumber).trim() : existing.registrationNumber,
          certificateNumber: data.certificateNumber ? String(data.certificateNumber).trim() : existing.certificateNumber,
          boardName: data.boardName ? String(data.boardName).trim() : existing.boardName,
          country: data.country ? String(data.country).trim() : existing.country,
          issueDate: data.issueDate ? String(data.issueDate) : existing.issueDate,
          officerName: data.officerName ? String(data.officerName).trim() : existing.officerName,
          officerDesignation: data.officerDesignation ? String(data.officerDesignation).trim() : existing.officerDesignation,
          signatureImageUrl: data.signatureImageUrl || existing.signatureImageUrl,
          sealImageUrl: data.sealImageUrl || existing.sealImageUrl,
          attachedCertificates: data.attachedCertificates || existing.attachedCertificates || [],
          fullyAttestedDocumentUrl: data.fullyAttestedDocumentUrl || existing.fullyAttestedDocumentUrl || ''
        };
        dbService.updateCertificate(verificationId, updatePayload);
        const updatedRecord = await dbService.getCertificateById(verificationId);
        res.status(200).json({
          success: true,
          message: 'Certificate updated successfully',
          certificate: updatedRecord
        });
        return;
      }
    }

    const settings = dbService.getSettings();

    const newCertificate: Certificate = {
      id: verificationId,
      applicantName: String(name).trim().toUpperCase(),
      fatherName: data.fatherName ? String(data.fatherName).trim().toUpperCase() : '',
      motherName: data.motherName ? String(data.motherName).trim().toUpperCase() : '',
      dob: data.dob ? String(data.dob) : '',
      certificateType: data.certificateType ? String(data.certificateType) : 'Electronic Attestation',
      examinationName: data.examinationName ? String(data.examinationName).trim() : undefined,
      rollNumber: data.rollNumber ? String(data.rollNumber).trim() : undefined,
      registrationNumber: data.registrationNumber ? String(data.registrationNumber).trim() : undefined,
      certificateNumber: data.certificateNumber ? String(data.certificateNumber).trim() : `AP-${Date.now()}`,
      boardName: data.boardName ? String(data.boardName).trim() : undefined,
      country: data.country ? String(data.country).trim() : 'Bangladesh',
      issueDate: data.issueDate ? String(data.issueDate) : new Date().toISOString().split('T')[0],
      qrCodeDataUrl: data.qrCodeDataUrl || '',
      officerName: data.officerName ? String(data.officerName).trim() : '',
      officerDesignation: data.officerDesignation ? String(data.officerDesignation).trim() : '',
      signatureImageUrl: data.signatureImageUrl || settings.globalSignatureUrl,
      sealImageUrl: data.sealImageUrl || settings.globalSealUrl,
      createdDate: new Date().toISOString(),
      status: 'VERIFIED',
      attachedCertificates: data.attachedCertificates || [],
      fullyAttestedDocumentUrl: data.fullyAttestedDocumentUrl || ''
    };

    dbService.addCertificate(newCertificate);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: {
        id: newCertificate.id,
        name: newCertificate.applicantName
      },
      certificate: newCertificate
    });
  } catch (err: any) {
    console.error('[API] Error creating certificate:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error creating certificate' });
  }
};

app.post([
  '/api/certificates',
  '/certificates',
  '/api/register',
  '/register',
  '/api/certificates/register',
  '/certificates/register',
  '/api/auth/register',
  '/auth/register',
  '/api/auth/signup',
  '/auth/signup',
  '/api/users/register',
  '/users/register',
  '/api/signup',
  '/signup'
], optionalAdminAuth, handleRegistration);

// ADMIN: Update Certificate
app.put(['/api/certificates/:id', '/certificates/:id'], authenticateAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;

    const success = dbService.updateCertificate(id, updatedData);
    if (!success) {
      res.status(404).json({ success: false, message: `Certificate with ID "${id}" not found in database.` });
      return;
    }

    res.json({
      success: true,
      message: 'Certificate updated successfully',
      certificate: dbService.getCertificateById(id)
    });
  } catch (err: any) {
    console.error('[API] Error updating certificate:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error updating certificate' });
  }
});

// ADMIN: Delete Certificate
app.delete(['/api/certificates/:id', '/certificates/:id'], authenticateAdmin, (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id;
  const success = dbService.deleteCertificate(id);

  if (!success) {
    res.status(404).json({ success: false, message: `Certificate with ID "${id}" not found.` });
    return;
  }

  res.json({
    success: true,
    message: 'Certificate deleted successfully'
  });
});

// ADMIN: Get Settings
app.get(['/api/settings', '/settings'], authenticateAdmin, (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, settings: dbService.getSettings() });
});

// ADMIN: Update Settings
app.post(['/api/settings', '/settings'], authenticateAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { defaultLogoUrl, globalSealUrl, globalSignatureUrl, customDomain } = req.body;
  
  dbService.updateSettings({
    defaultLogoUrl,
    globalSealUrl,
    globalSignatureUrl,
    customDomain
  });

  res.json({
    success: true,
    message: 'System stamp/seal templates updated successfully',
    settings: dbService.getSettings()
  });
});

// ADMIN: Change Password
app.post(['/api/settings/change-password', '/settings/change-password'], authenticateAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    res.status(400).json({ success: false, message: 'Old and new passwords are required' });
    return;
  }

  const success = dbService.changeAdminPassword(String(oldPassword), String(newPassword));
  if (!success) {
    res.status(400).json({ success: false, message: 'Incorrect old password' });
    return;
  }

  res.json({ success: true, message: 'Admin password changed successfully' });
});

// ==========================================
// VITE CLIENT DEV / PROD HANDLER
// ==========================================

// Export Express app for Vercel Serverless Functions
export default app;
export { app };

// Start standalone HTTP server in non-Vercel environments (Cloud Run / container / local dev)
if (!process.env.VERCEL && !process.env.VERCEL_ENV) {
  async function start() {
    if (process.env.NODE_ENV !== "production") {
      // Development mode
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      // Production mode
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Bangladesh e-Apostille Verification System running on http://localhost:${PORT}`);
    });
  }

  start();
}
