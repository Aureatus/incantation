import { useEffect, useRef, useState } from "react";

type LivePreviewProps = {
  serviceRunning: boolean;
  previewAvailable: boolean;
  backendLabel: string;
  cameraUnavailable: boolean;
  compact?: boolean;
};

export const LivePreview = ({
  serviceRunning,
  previewAvailable,
  backendLabel,
  cameraUnavailable,
  compact = false,
}: LivePreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingFrameRef = useRef<Uint8Array | null>(null);
  const drawingRef = useRef(false);
  const mountedRef = useRef(true);
  const hasFrameRef = useRef(false);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    mountedRef.current = true;

    const renderLatestFrame = async () => {
      if (drawingRef.current) {
        return;
      }

      drawingRef.current = true;

      while (pendingFrameRef.current !== null && mountedRef.current) {
        const frame = pendingFrameRef.current;
        pendingFrameRef.current = null;

        const bitmap = await createImageBitmap(
          new Blob([frame], { type: "image/jpeg" }),
        );

        const canvas = canvasRef.current;
        if (canvas !== null) {
          if (
            canvas.width !== bitmap.width ||
            canvas.height !== bitmap.height
          ) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }

          const context = canvas.getContext("2d");
          if (context !== null) {
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          }
        }

        bitmap.close();
        if (!hasFrameRef.current) {
          hasFrameRef.current = true;
          setHasFrame(true);
        }
      }

      drawingRef.current = false;
    };

    const unsubscribe = window.incantation.onPreviewFrame((frame) => {
      pendingFrameRef.current = new Uint8Array(frame);
      void renderLatestFrame();
    });

    return () => {
      mountedRef.current = false;
      pendingFrameRef.current = null;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (serviceRunning && previewAvailable && !cameraUnavailable) {
      return;
    }

    pendingFrameRef.current = null;
    hasFrameRef.current = false;
    setHasFrame(false);

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas !== null && context !== null) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [cameraUnavailable, previewAvailable, serviceRunning]);

  const overlayText = !serviceRunning
    ? `Vision service is stopped. Start it to see the ${backendLabel.toLowerCase()} backend.`
    : !previewAvailable
      ? `${backendLabel} is live, but this backend does not expose a camera preview yet.`
      : cameraUnavailable
        ? "Backend camera is unavailable. The preview here only appears when the Python vision service can open the webcam."
        : "Waiting for backend preview frames...";

  return (
    <div className={`camera-frame ${compact ? "camera-frame-compact" : ""}`}>
      <canvas
        ref={canvasRef}
        className={`camera-canvas ${compact ? "camera-canvas-compact" : ""}`}
      />
      {!hasFrame ? <div className="camera-overlay">{overlayText}</div> : null}
    </div>
  );
};
