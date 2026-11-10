export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, filename } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    }

    // Limpa prefixo data:image/...;base64, se presente
    const cleanBase64 = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const safeFilename = filename || `comprovante-${Date.now()}.jpg`;

    const customUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    let errImgur = '';
    let errCatbox = '';
    let errLitter = '';

    // ========================================================
    // Provedor #1 Oficial: Imgur (com rotação de Client-IDs)
    // ========================================================
    const imgurClientIds = ['546c25a59c58ad7', 'c8c692df5e0cba0', 'e9df0fb99f6dcf7'];

    for (const clientId of imgurClientIds) {
      try {
        const imgurForm = new FormData();
        imgurForm.append('image', cleanBase64);
        imgurForm.append('type', 'base64');

        const imgurRes = await fetch('https://api.imgur.com/3/image', {
          method: 'POST',
          headers: { 
            Authorization: `Client-ID ${clientId}`,
            'User-Agent': customUA
          },
          body: imgurForm,
        });

        if (imgurRes.ok) {
          const imgurData = await imgurRes.json().catch(() => ({}));
          if (imgurData.success && imgurData.data?.link) {
            let directUrl = imgurData.data.link;
            // Garante link direto permanente https://i.imgur.com/xxxx.ext
            if (directUrl.startsWith('http://')) {
              directUrl = directUrl.replace('http://', 'https://');
            }
            return res.status(200).json({ success: true, url: directUrl, provider: 'imgur' });
          } else {
            errImgur = `Imgur ${clientId} body: ${JSON.stringify(imgurData).slice(0, 100)}`;
          }
        } else {
          errImgur = `Imgur ${clientId} HTTP ${imgurRes.status}: ${(await imgurRes.text()).slice(0, 100)}`;
        }
      } catch (eImgur: any) {
        errImgur = `Imgur ${clientId} err: ${eImgur?.message || String(eImgur)}`;
        console.warn(`Imgur client ${clientId} failed, rotating...`, eImgur);
      }
    }

    // ========================================================
    // Fallback Permanente #2: Catbox.moe
    // ========================================================
    try {
      const formData = new FormData();
      formData.append('reqtype', 'fileupload');
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      formData.append('fileToUpload', blob, safeFilename);

      const catboxRes = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        headers: { 'User-Agent': customUA },
        body: formData,
      });

      if (catboxRes.ok) {
        const url = (await catboxRes.text()).trim();
        if (url && url.startsWith('http')) {
          const secureUrl = url.replace('http://', 'https://');
          return res.status(200).json({ success: true, url: secureUrl, provider: 'catbox' });
        } else {
          errCatbox = `Status 200 but body: ${url.slice(0, 100)}`;
        }
      } else {
        errCatbox = `HTTP ${catboxRes.status}: ${(await catboxRes.text()).slice(0, 100)}`;
      }
    } catch (e1: any) {
      errCatbox = e1?.message || String(e1);
      console.warn('Catbox provider fallback failed...', e1);
    }

    // ========================================================
    // Fallback #3: Litterbox (72h de contingência)
    // ========================================================
    try {
      const formData2 = new FormData();
      formData2.append('reqtype', 'fileupload');
      formData2.append('time', '72h');
      const blob2 = new Blob([buffer], { type: 'image/jpeg' });
      formData2.append('fileToUpload', blob2, safeFilename);

      const litterRes = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
        method: 'POST',
        headers: { 'User-Agent': customUA },
        body: formData2,
      });

      if (litterRes.ok) {
        const url = (await litterRes.text()).trim();
        if (url && url.startsWith('http')) {
          const secureUrl = url.replace('http://', 'https://');
          return res.status(200).json({ success: true, url: secureUrl, provider: 'litterbox' });
        } else {
          errLitter = `Body: ${url.slice(0, 100)}`;
        }
      } else {
        errLitter = `HTTP ${litterRes.status}: ${(await litterRes.text()).slice(0, 100)}`;
      }
    } catch (e2: any) {
      errLitter = e2?.message || String(e2);
      console.warn('Litterbox provider fallback failed...', e2);
    }

    return res.status(500).json({
      error: 'Não foi possível hospedar a imagem no momento.',
      debug: { errImgur, errCatbox, errLitter }
    });
  } catch (error: any) {
    console.error('Upload Error:', error);
    return res.status(500).json({ error: error.message || 'Erro ao processar imagem' });
  }
}
