import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

let configured = false;

function ensureConfigured() {
  if (configured) return;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  configured = true;
}

const LOGO_FOLDER = 'tymoe/logos';

function logoPublicId(orgId: string): string {
  return `${LOGO_FOLDER}/${orgId}`;
}

export async function uploadLogo(
  file: Buffer,
  orgId: string,
): Promise<{ url: string; publicId: string }> {
  ensureConfigured();

  const dataUri = `data:image/jpeg;base64,${file.toString('base64')}`;

  const result: UploadApiResponse = await cloudinary.uploader.upload(dataUri, {
    public_id: logoPublicId(orgId),
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    transformation: [
      { width: 512, height: 512, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' },
    ],
  });

  return { url: result.secure_url, publicId: result.public_id };
}

export async function deleteLogo(orgId: string): Promise<void> {
  ensureConfigured();
  await cloudinary.uploader.destroy(logoPublicId(orgId), { invalidate: true });
}
