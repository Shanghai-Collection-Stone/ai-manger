import QRCode from 'qrcode';

/**
 * @description 使用生产级二维码库生成 SVG，避免手写 QR 编码导致扫码不稳定。
 * @keyword-en qrcode svg article-library production-library
 */
export const createQrCodeSvg = async (
  text,
  {
    scale = 5,
    margin = 4,
    errorCorrectionLevel = 'Q',
    darkColor = '#0f172aff',
    lightColor = '#ffffffff',
  } = {},
) => {
  try {
    return await QRCode.toString(String(text ?? ''), {
      type: 'svg',
      errorCorrectionLevel,
      scale,
      margin,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    });
  } catch (error) {
    const message = String(error?.message ?? '');
    if (/too big|cannot contain this amount of data/i.test(message)) {
      throw new Error('QR_CONTENT_TOO_LONG');
    }
    throw error;
  }
};
