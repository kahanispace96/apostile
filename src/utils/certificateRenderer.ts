/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { Certificate } from '../types';

/**
 * Helper to convert standard date string (e.g. 2026-04-23) to DD-MMM-YYYY format (e.g. 10-Aug-2026)
 */
function formatDateToStandard(dateStr: string): string {
  try {
    if (!dateStr) return '10-Aug-2026';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (e) {
    return dateStr;
  }
}

/**
 * Helper to get digital signature date timestamp (e.g. 2026.08.10 11:07:55 +06:00)
 */
function getDigitalSignatureTimestamp(dateStr: string): string {
  try {
    if (!dateStr) return '2026.08.10 11:07:55 +06:00';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return `${dateStr} 11:07:55 +06:00`;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}.${month}.${day} 11:07:55 +06:00`;
  } catch (e) {
    return `${dateStr} 11:07:55 +06:00`;
  }
}

// Default MoFA Seal SVG Data URI (blue circular seal with MoFA & map of Bangladesh)
const DEFAULT_MOFA_SEAL = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <circle cx="100" cy="100" r="95" fill="none" stroke="%231e3a8a" stroke-width="4"/>
  <circle cx="100" cy="100" r="88" fill="none" stroke="%231e3a8a" stroke-width="2" stroke-dasharray="4,2"/>
  <path id="curveTop" fill="none" d="M 25 100 A 75 75 0 0 1 175 100" />
  <path id="curveBottom" fill="none" d="M 175 100 A 75 75 0 0 1 25 100" />
  <text font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="%231e3a8a">
    <textPath href="%23curveTop" startOffset="50%" text-anchor="middle">★ Consular %26 Welfare Wing ★</textPath>
  </text>
  <text font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="%231e3a8a">
    <textPath href="%23curveBottom" startOffset="50%" text-anchor="middle">Ministry of Foreign Affairs ★ Govt. of Bangladesh</textPath>
  </text>
  <rect x="50" y="80" width="100" height="36" fill="%23ffffff" stroke="%231e3a8a" stroke-width="1.5" rx="4"/>
  <text x="100" y="94" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="%231e3a8a" text-anchor="middle">Verified by</text>
  <text x="100" y="108" font-family="Arial, sans-serif" font-size="12" font-weight="extrabold" fill="%231e3a8a" text-anchor="middle">MoFA</text>
</svg>`;

// Default Officer Signature SVG Data URI (cursive ink signature)
const DEFAULT_SIGNATURE_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 100" width="250" height="100">
  <path d="M 20 60 C 30 20, 40 10, 50 50 C 60 70, 70 30, 80 40 C 90 50, 100 20, 110 60 C 120 40, 130 50, 140 30 C 150 60, 160 20, 170 50 C 180 70, 200 10, 220 50 C 230 40, 240 60, 245 45" fill="none" stroke="%231e293b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const WATERMARK_URL = "https://upload.wikimedia.org/wikipedia/commons/8/84/Government_Seal_of_Bangladesh.svg";

/**
 * Loads image safely onto HTML5 canvas with CORS and fallback
 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url || !url.trim()) {
      resolve(null);
      return;
    }
    const img = new Image();
    const isExternal = url.startsWith('http://') || url.startsWith('https://');
    if (isExternal) {
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
    }
    img.onload = () => resolve(img);
    img.onerror = (err) => {
      console.warn('[CertificateRenderer] Image load failed:', url.slice(0, 50), err);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Draws the high-fidelity official Bangladesh e-Apostille on an HTML5 canvas.
 * Perfectly replicates the official government format with exact layouts, custom watermark background,
 * and clear non-overlapping QR code.
 */
export async function renderCertificateToCanvas(
  canvas: HTMLCanvasElement,
  cert: Certificate,
  qrCodeUrl: string,
  verificationDomain?: string
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Set standard high-fidelity A4 dimensional resolution for crisp output (Width: 1000px, Height: 1414px)
  canvas.width = 1000;
  canvas.height = 1414;

  const width = canvas.width;
  const height = canvas.height;

  // 1. Draw Clean White Solid Page
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 2. Beautiful Thin Border Framing around A4 page
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(40, 40, width - 80, height - 80);

  // Prepare images to load
  const sealSrc = cert.sealImageUrl && cert.sealImageUrl.trim() ? cert.sealImageUrl : DEFAULT_MOFA_SEAL;
  const sigSrc = cert.signatureImageUrl && cert.signatureImageUrl.trim() ? cert.signatureImageUrl : DEFAULT_SIGNATURE_SVG;

  let finalQrDataUrl = qrCodeUrl || cert.qrCodeDataUrl;
  if (!finalQrDataUrl) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://verification.gov.bd';
    const verifyLink = `${origin}/?id=${encodeURIComponent(cert.id || '')}&roll=${encodeURIComponent(cert.rollNumber || '')}&reg=${encodeURIComponent(cert.registrationNumber || '')}`;
    try {
      finalQrDataUrl = await QRCode.toDataURL(verifyLink, { margin: 1, width: 350 });
    } catch (e) {
      console.warn('Auto QRCode generation failed:', e);
    }
  }

  const [watermarkImg, sealImg, sigImg, qrImg] = await Promise.all([
    loadImage(WATERMARK_URL),
    loadImage(sealSrc),
    loadImage(sigSrc),
    finalQrDataUrl ? loadImage(finalQrDataUrl) : Promise.resolve(null)
  ]);

  // 3. Watermark Background
  if (watermarkImg) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.drawImage(watermarkImg, (width - 460) / 2, (height - 460) / 2, 460, 460);
    ctx.restore();
  }

  // 4. Header Title Block: "e-APOSTILLE"
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 25pt sans-serif';
  ctx.fillText('e-APOSTILLE', width / 2, 115);

  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 12.5pt sans-serif';
  ctx.fillText('(Convention de La Haye du 5 octobre 1961)', width / 2, 148);

  ctx.fillStyle = '#475569';
  ctx.font = 'italic 9.5pt sans-serif';
  ctx.fillText('(Also valid for the countries that are not in reciprocal arrangement with Bangladesh under the', width / 2, 180);
  ctx.fillText('Apostille Convention of 1961, subject to proper legalisation)', width / 2, 198);

  // 5. "Issuing Authority" Header Label
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 16.5pt sans-serif';
  ctx.fillText('Issuing Authority', width / 2, 265);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(350, 278);
  ctx.lineTo(650, 278);
  ctx.stroke();

  // 6. Draw Numbered Lines 1 to 4 under Issuing Authority
  const colXLabel = 90;
  const colXValue = 350;

  // Line 1: Country
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('1. Country:', colXLabel, 320);
  ctx.font = 'bold 13.5pt sans-serif';
  ctx.fillText((cert.country || 'BANGLADESH').toUpperCase(), colXValue, 320);

  // Sublabel before Line 2
  ctx.fillStyle = '#475569';
  ctx.font = 'italic 11pt sans-serif';
  ctx.fillText('The public document', colXLabel, 352);

  // Line 2: has been signed by
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('2. has been signed by:', colXLabel, 388);
  ctx.font = 'bold 13.5pt sans-serif';
  ctx.fillText(cert.officerName || 'Md. Nazrul Islam', colXValue, 388);

  // Line 3: acting in the capacity of
  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('3. acting in the capacity of:', colXLabel, 428);
  ctx.font = 'bold 13.5pt sans-serif';
  ctx.fillText(cert.officerDesignation || 'Assistant Secretary (Consular)', colXValue, 428);

  // Line 4: bears the seal/stamp of
  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('4. bears the seal/stamp of:', colXLabel, 468);
  ctx.font = 'bold 13.5pt sans-serif';
  ctx.fillText(cert.boardName || 'Dhaka', colXValue, 468);

  // 7. "Certified" Header Label
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 16.5pt sans-serif';
  ctx.fillText('Certified', width / 2, 535);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(350, 548);
  ctx.lineTo(650, 548);
  ctx.stroke();

  // Lines 5 to 8
  ctx.textAlign = 'left';

  // Line 5: at
  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('5. at:', colXLabel, 590);
  ctx.font = 'bold 13.5pt sans-serif';
  ctx.fillText('Dhaka, Bangladesh', colXValue, 590);

  // Line 6: the
  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('6. the:', colXLabel, 630);
  ctx.font = 'bold 13.5pt sans-serif';
  ctx.fillText(formatDateToStandard(cert.issueDate), colXValue, 630);

  // Line 7: by
  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('7. by:', colXLabel, 670);
  ctx.font = 'bold 12.5pt sans-serif';
  ctx.fillText('MD. RASHID ABID, Assistant Secretary, Ministry of Foreign Affairs', colXValue, 670);

  // Line 8: N°
  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('8. N°:', colXLabel, 710);
  ctx.font = 'bold 13.5pt sans-serif';
  ctx.fillText(cert.id || 'APO-2026-0810-0002', colXValue, 710);

  // 8. Items 9 & 10 (Seal/stamp & Signature)
  const columnsY = 770;
  const col9X = colXLabel;
  const col10X = 580;

  ctx.font = 'bold 11pt sans-serif';
  ctx.fillText('9. Seal/stamp', col9X, columnsY);
  ctx.fillText('10. Signature', col10X, columnsY);

  if (sealImg) {
    ctx.drawImage(sealImg, col9X, columnsY + 15, 120, 120);
  }

  if (sigImg) {
    ctx.drawImage(sigImg, col10X, columnsY + 25, 160, 65);
  }

  // 9. Digital Signature Info (Bottom Left) & QR Code (Bottom Right)
  const digitalSigY = 1120;

  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 10.5pt sans-serif';

  const signeeName = cert.attachedCertificates && cert.attachedCertificates.length > 0 && cert.attachedCertificates[0].attestations[0]
    ? cert.attachedCertificates[0].attestations[0].officerName
    : 'Golam Mohammad Faruk';

  ctx.fillText(`Digitally signed by ${signeeName}`, colXLabel, digitalSigY);

  ctx.fillStyle = '#334155';
  ctx.font = '600 10.5pt sans-serif';
  ctx.fillText(`Date: ${getDigitalSignatureTimestamp(cert.issueDate)}`, colXLabel, digitalSigY + 25);
  ctx.fillText('Reason: Document Signing', colXLabel, digitalSigY + 50);
  ctx.fillText('Location: Ministry of Foreign Affairs, Dhaka, BD', colXLabel, digitalSigY + 75);

  // Dedicated QR Code Area in Bottom Right with Quiet Zone
  const qrSize = 190;
  const qrX = 710;
  const qrY = 1100;

  // Solid quiet zone background to protect QR from any background strokes
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20);

  if (qrImg) {
    // Draw crisp uploaded QR code image
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  } else {
    // Render clean reserved QR Code box when not uploaded yet
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(qrX, qrY, qrSize, qrSize);
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 10pt sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QR CODE AREA', qrX + qrSize / 2, qrY + qrSize / 2 - 8);
    ctx.font = 'italic 8pt sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('(Upload QR from Admin)', qrX + qrSize / 2, qrY + qrSize / 2 + 10);
  }
  ctx.restore();

  // 10. Document Footnotes strictly constrained to prevent any QR overlap
  ctx.fillStyle = '#475569';
  ctx.font = '500 8.5pt sans-serif';
  ctx.fillText('* To see the Apostille documents, please scan the QR code', colXLabel, 1275);

  const domainStr = verificationDomain || (typeof window !== 'undefined' ? window.location.host : 'mygov.bd');
  const visitText = `* For verification of the e-Apostille, please visit: ${domainStr}`;
  // Constrain text to max width 580px so it terminates before x=670, completely clear of QR code at x=710
  ctx.fillText(visitText, colXLabel, 1295, 580);
}

/**
 * Downloads the drawn certificate canvas as high-fidelity standard A4 PDF (210mm x 297mm)
 */
export async function downloadCanvasAsPdf(
  cert: Certificate,
  qrCodeUrl: string,
  verificationDomain: string,
  filename: string
) {
  // Create offscreen canvas to guarantee clean, fresh rendering with all assets
  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.width = 1000;
  pdfCanvas.height = 1414;

  await renderCertificateToCanvas(pdfCanvas, cert, qrCodeUrl, verificationDomain);

  const imgData = pdfCanvas.toDataURL('image/jpeg', 1.0);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Exactly 210mm x 297mm A4 dimensions
  pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);

  try {
    pdf.save(filename);
  } catch (err) {
    console.warn('PDF save fallback triggered', err);
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

/**
 * Downloads the drawn certificate canvas as JPEG
 */
export function downloadCanvasAsJpg(canvas: HTMLCanvasElement, filename: string) {
  const imgData = canvas.toDataURL('image/jpeg', 1.0);
  const link = document.createElement('a');
  link.href = imgData;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

