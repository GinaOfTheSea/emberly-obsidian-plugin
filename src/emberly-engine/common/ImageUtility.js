
export default class ImageUtility {

  static IsImage(target) {
    let ext = target.name.substr(target.name.lastIndexOf(".") + 1).toLowerCase().trim();
    return ext === "jpeg" || ext === "jpg" || ext === "png" || ext === "webp" || ext === "gif";
  }

  static async GenerateFilePreviewAsync(file, width) {
    return new Promise((resolve) => ImageUtility.GeneratePreviewCallback(file, width, (e) => resolve(e)));
  }

  static async GeneratePreviewFromCanvasAsync(elem, filename, resolutionX, resolutionY, s = 1, background = null) {
    return new Promise((resolve) => ImageUtility.GeneratePreviewFromCanvasCallback(elem, filename, resolutionX, resolutionY, (e) => resolve(e), s, background));
  }

  static GeneratePreviewFromCanvasCallback(elem, fileName, resolutionX, resolutionY, callback, s = 1, background = null) {    
    const copyCanvas = document.createElement("canvas");
    copyCanvas.width = resolutionX;
    copyCanvas.height = resolutionY;
    const copyCtx = copyCanvas.getContext("2d");
    
    if (!!background) {
      copyCtx.fillStyle = background;
      copyCtx.fillRect(0, 0, copyCanvas.width, copyCanvas.height)
    }

    const eWidth = elem.width;
    const eHeight = elem.height;
    const cWidth = copyCanvas.width;
    const cHeight = copyCanvas.height;

    const eRatio = eWidth / eHeight;
    const cRatio = cWidth / cHeight;

    if (eRatio > cRatio) {
      const w = cWidth;
      const h = cWidth / eRatio;

      copyCtx.drawImage(
        elem, 
        w * (1 - s) * 0.5, 
        ((cHeight - h) / 2) + ((1 - s) * 0.5) * h, 
        w * s, 
        h * s
      );
    } else {
      const h = cHeight;
      const w = cHeight * eRatio;

      copyCtx.drawImage(elem, 
        ((cWidth - w) / 2) + ((1 - s) * 0.5) * w, 
        h * (1 - s) * 0.5, 
        w * s,  
        h * s
      );
    }


    copyCtx.canvas.toBlob((blob) => {
      const result = new File([blob], fileName, {
        type: "image/png",
        lastModified: Date.now()
      });

      callback(result);
    }, "image/png", 0.925);
  }

  static GeneratePreviewCallback(file, targetWidth, callback) {
    const img = new Image();

    img.onload = () => {
      const elem = document.createElement("canvas");
      const ctx = elem.getContext("2d");
      const renderW = targetWidth;
      const renderH = img.height * (targetWidth / img.width);
      const finalW = Math.min(renderW, img.width);
      const finalH = Math.min(renderH, img.height);
      elem.width = finalW;
      elem.height = finalH;

      ctx.fillStyle = "#F5F7F6";
      ctx.fillRect(0, 0, elem.width, elem.height);
      ctx.drawImage(img, 0, 0, finalW, finalH);

      ctx.canvas.toBlob((blob) => {
        const result = new File([blob], file.name, {
          type: "image/jpeg",
          lastModified: Date.now()
        });

        callback(result);
      }, "image/jpeg", 0.925);

    };

    img.src = URL.createObjectURL(file);
  }

  static CreateImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.addEventListener('load', () => resolve(image))
      image.addEventListener('error', error => reject(error))
      image.setAttribute('crossOrigin', 'anonymous') // needed to avoid cross-origin issues on CodeSandbox
      image.src = url
    });
  }

  static GetRadianAngle(degreeValue) {
    return (degreeValue * Math.PI) / 180
  }

  /**
   * This function was adapted from the one in the ReadMe of https://github.com/DominicTobias/react-image-crop
   * @param {File} image - Image File url
   * @param {Object} pixelCrop - pixelCrop Object provided by react-easy-crop
   * @param {number} rotation - optional rotation parameter
   */
  static async GetCroppedImage(imageSrc, pixelCrop, rotation = 0, maxWidth = 256) { // TODO make the safearea max 1024 or something. add a Math.min to maxSize, also need to account for it further down.
    const image = await ImageUtility.CreateImage(imageSrc)
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const maxSize = Math.max(image.width, image.height);

    const maxSizeScaled = Math.min(1024, maxSize);
    const ratio = maxSizeScaled / maxSize;
    const safeArea = 2 * ((maxSizeScaled / 2) * Math.sqrt(2));

    // set each dimensions to double largest dimension to allow for a safe area for the
    // image to rotate in without being clipped by canvas context
    canvas.width = safeArea;
    canvas.height = safeArea;

    // translate canvas context to a central location on image to allow rotating around the center.
    ctx.translate(safeArea / 2, safeArea / 2);
    ctx.rotate(ImageUtility.GetRadianAngle(rotation));
    ctx.translate(-safeArea / 2, -safeArea / 2);

    // draw rotated image and store data.
    ctx.fillStyle = "#F5F7F6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(
      image,
      safeArea / 2 - image.width * 0.5 * ratio,
      safeArea / 2 - image.height * 0.5 * ratio,
      image.width * ratio,
      image.height * ratio
    );

    const data = ctx.getImageData(0, 0, safeArea, safeArea);

    // set canvas width to final desired crop size - this will clear existing context
    // TODO
    canvas.width = pixelCrop.width * ratio;
    canvas.height = pixelCrop.height * ratio;

    // paste generated rotate image with correct offsets for x,y crop values.
    ctx.putImageData(
      data,
      0 - safeArea / 2 + image.width * 0.5 * ratio - pixelCrop.x * ratio,
      0 - safeArea / 2 + image.height * 0.5 * ratio - pixelCrop.y * ratio
    );

    if (canvas.width > maxWidth) {
      const resizedCanvas = document.createElement("canvas");
      resizedCanvas.width = maxWidth;
      resizedCanvas.height = maxWidth * (canvas.height / canvas.width);

      const resizedContext = resizedCanvas.getContext("2d");
      resizedContext.drawImage(canvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
      return resizedCanvas.toDataURL("image/jpeg");
    }

    // As Base64 string
    return canvas.toDataURL("image/jpeg");
  }
}