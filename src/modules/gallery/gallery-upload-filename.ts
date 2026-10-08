/**
 * @description 修正 multipart 按 latin1 解码导致的 UTF-8 中文上传文件名乱码；已是 Unicode 或转换无效时保留原名。
 * @keyword-cn 上传文件名, 中文乱码修复
 * @keyword-en upload-filename, mojibake-repair
 */
export function normalizeGalleryUploadFilename(name: string): string {
  const original = String(name ?? '');
  if ([...original].some((character) => character.codePointAt(0)! > 0xff)) {
    return original;
  }
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? original : decoded;
}
