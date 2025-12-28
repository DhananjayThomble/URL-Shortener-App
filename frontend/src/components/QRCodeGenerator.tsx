import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface QRCodeGeneratorProps {
  url: string;
  size?: number;
}

export const QRCodeGenerator = ({ url, size = 200 }: QRCodeGeneratorProps) => {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const downloadQRCode = (format: "svg" | "png") => {
    if (!qrRef.current) return;

    const svg = qrRef.current.querySelector("svg");
    if (!svg) return;

    if (format === "svg") {
      const svgData = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgData], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "qrcode.svg";
      link.click();
      URL.revokeObjectURL(url);
      toast.success("QR Code downloaded as SVG");
    } else {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const svgData = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);

      img.onload = () => {
        canvas.width = size * 2;
        canvas.height = size * 2;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, size * 2, size * 2);
        
        const pngUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = pngUrl;
        link.download = "qrcode.png";
        link.click();
        URL.revokeObjectURL(svgUrl);
        toast.success("QR Code downloaded as PNG");
      };

      img.src = svgUrl;
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div 
        ref={qrRef} 
        className="p-4 bg-white rounded-xl"
      >
        <QRCodeSVG
          value={url}
          size={size}
          bgColor="#ffffff"
          fgColor="#000000"
          level="H"
          includeMargin={false}
        />
      </div>
      
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => downloadQRCode("svg")}>
          <Download className="w-4 h-4 mr-2" />
          SVG
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadQRCode("png")}>
          <Download className="w-4 h-4 mr-2" />
          PNG
        </Button>
        <Button variant="outline" size="sm" onClick={copyToClipboard}>
          {copied ? (
            <Check className="w-4 h-4 mr-2" />
          ) : (
            <Copy className="w-4 h-4 mr-2" />
          )}
          Copy
        </Button>
      </div>
    </div>
  );
};
