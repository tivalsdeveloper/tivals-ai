import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { InferenceClient } from "npm:@huggingface/inference";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors,
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json();

    const prompt = String(body.prompt || "")
      .trim()
      .slice(0, 1500);

    if (!prompt) {
      return json(
        { error: "Enter a description first." },
        400,
      );
    }

    const type =
      body.type === "video" ? "video" : "image";

    /*
    =========================================
    IMAGE — PIXAZO
    =========================================
    */

    if (type === "image") {
      const nvidiaKey = Deno.env.get("NVIDIA_API_KEY") || "";
      if (nvidiaKey) {
        try {
          const response = await fetch("https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-medium", {
            method: "POST",
            headers: { "Authorization": `Bearer ${nvidiaKey}`, "Accept": "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "text-to-image", model: "sd3", prompt, aspect_ratio: "1:1", output_format: "jpeg", steps: 30, cfg_scale: 5 })
          });
          const data = await response.json().catch(() => ({}));
          const image = String(data?.image || data?.data?.image || data?.b64_json || data?.data?.b64_json || "");
          if (response.ok && image) {
            const dataUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
            const encoded = dataUrl.split(",")[1] || "";
            const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
            const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
            const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
            if (supabaseUrl && serviceRoleKey) {
              const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
              const filename = `images/${Date.now()}-${crypto.randomUUID()}.jpg`;
              const uploaded = await supabase.storage.from("ai-media").upload(filename, bytes, { contentType: "image/jpeg", cacheControl: "3600", upsert: false });
              if (!uploaded.error) {
                const publicUrl = supabase.storage.from("ai-media").getPublicUrl(filename).data.publicUrl;
                return json({ output: publicUrl, image: publicUrl, provider: "nvidia", model: "stabilityai/stable-diffusion-3-medium" });
              }
            }
            console.error("NVIDIA image was returned but could not be stored; falling back to Pixazo.");
          }
          console.error("NVIDIA image generation failed; falling back to Pixazo", response.status, data);
        } catch (error) { console.error("NVIDIA image generation error; falling back to Pixazo", error); }
      }

      const pixazoKey =
        Deno.env.get("PIXAZO_API_KEY");

      if (!pixazoKey) {
        return json(
          { error: "PIXAZO_API_KEY is not configured." },
          500,
        );
      }

      const response = await fetch(
        "https://gateway.pixazo.ai/flux-1-schnell/v1/getData",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Ocp-Apim-Subscription-Key": pixazoKey,
            "Cache-Control": "no-cache",
          },

          body: JSON.stringify({
            prompt,
            num_steps: 4,
            height: 1024,
            width: 1024,
          }),
        },
      );

      const raw = await response.text();

      let data: any;

      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw };
      }

      if (!response.ok) {
        return json(
          {
            error:
              data?.error?.message ||
              data?.error ||
              data?.message ||
              `Image generation failed (${response.status}).`,
          },
          response.status,
        );
      }

      return json(data);
    }

    /*
    =========================================
    VIDEO — HUGGING FACE + FAL
    =========================================
    */

    if (type === "video") {
      const nvidiaKey = Deno.env.get("NVIDIA_API_KEY") || "";
      let nvidiaError = "";
      if (nvidiaKey) {
        try {
          const response = await fetch("https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano", {
            method: "POST",
            headers: { Authorization: `Bearer ${nvidiaKey}`, Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ model_mode: "text2video", prompt, resolution: "480_16_9", num_frames: 25, num_inference_steps: 35, fps: 24, seed: 42 })
          });
          const data = await response.json().catch(() => ({}));
          const encoded = String(data?.b64_video || "");
          if (response.ok && encoded) {
            const bytes = Uint8Array.from(atob(encoded.replace(/^data:video\/mp4;base64,/, "")), (c) => c.charCodeAt(0));
            if (bytes.length < 1024 || String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp") throw new Error("NVIDIA returned an invalid MP4.");
            const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
            const filename = `videos/${Date.now()}-${crypto.randomUUID()}.mp4`;
            const { error } = await supabase.storage.from("ai-media").upload(filename, bytes, { contentType: "video/mp4", cacheControl: "3600", upsert: false });
            if (error) throw new Error(`Video storage failed: ${error.message}`);
            const url = supabase.storage.from("ai-media").getPublicUrl(filename).data.publicUrl;
            console.log("NVIDIA Cosmos3 video generation complete", filename);
            return json({ output: url, video: url, provider: "nvidia", model: "cosmos3-nano" });
          }
          nvidiaError = response.status === 404 ? "HTTP 404" : response.status === 202 ? "NVIDIA accepted the request but did not return a completed video." : String(data?.detail?.message || data?.detail || data?.error?.message || data?.error || `NVIDIA returned HTTP ${response.status}`).slice(0, 300);
          console.error("NVIDIA Cosmos3 video generation failed", response.status, nvidiaError);
        } catch (error) {
          nvidiaError = String((error as Error)?.message || error).slice(0, 300);
          console.error("NVIDIA Cosmos3 video generation error", nvidiaError);
        }
      }
      const hfToken =
        Deno.env.get("HF_TOKEN");

      if (!hfToken) {
        return json(
          { error: nvidiaError || "No video provider is configured." },
          500,
        );
      }

      const supabaseUrl =
        Deno.env.get("SUPABASE_URL");

      const serviceRoleKey =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !serviceRoleKey) {
        return json(
          {
            error:
              "Supabase server credentials are unavailable.",
          },
          500,
        );
      }

      console.log(
        "Starting Hugging Face Fal video generation",
      );

      /*
       * Hugging Face handles Fal's provider-specific
       * API format and routing.
       */
      const hf = new InferenceClient(hfToken);

      let video: Blob;

      try {
        video = await hf.textToVideo({
          provider: "fal-ai",

          model:
            "Wan-AI/Wan2.2-TI2V-5B",

          inputs: prompt,
        });
      } catch (error) {
        console.error(
          "Hugging Face video generation failed:",
          error,
        );

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        if (
          /credit|balance|payment|quota/i.test(message)
        ) {
          return json(
            {
              error:
                nvidiaError && /HTTP 404/.test(nvidiaError) ? "NVIDIA video endpoint returned 404 for this API key, and Hugging Face video credits are exhausted. Video generation needs an enabled provider." : nvidiaError ? `NVIDIA video provider failed: ${nvidiaError}; Hugging Face video credits are exhausted.` : "Free video-generation credits are unavailable or exhausted.",
            },
            402,
          );
        }

        if (
          /rate.?limit|too many requests/i.test(message)
        ) {
          return json(
            {
              error:
                "Video generation rate limit reached. Try again later.",
            },
            429,
          );
        }

        return json(
          {
            error:
              message ||
              "Hugging Face video generation failed.",
          },
          502,
        );
      }

      if (!video || video.size === 0) {
        return json(
          {
            error:
              "The video provider returned an empty video.",
          },
          502,
        );
      }

      /*
      =========================================
      SAVE VIDEO TO SUPABASE STORAGE
      =========================================
      */

      const supabase =
        createClient(
          supabaseUrl,
          serviceRoleKey,
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          },
        );

      const timestamp = Date.now();

      const random =
        crypto.randomUUID();

      const filename =
        `videos/${timestamp}-${random}.mp4`;

      const bytes =
        new Uint8Array(
          await video.arrayBuffer(),
        );

      console.log(
        `Uploading generated video: ${bytes.length} bytes`,
      );

      const { error: uploadError } =
        await supabase.storage
          .from("ai-media")
          .upload(
            filename,
            bytes,
            {
              contentType: "video/mp4",
              cacheControl: "3600",
              upsert: false,
            },
          );

      if (uploadError) {
        console.error(
          "Storage upload failed:",
          uploadError,
        );

        return json(
          {
            error:
              `Video was generated but could not be saved: ${uploadError.message}`,
          },
          500,
        );
      }

      /*
       * ai-media is public, so generate
       * an HTTPS public URL.
       */

      const { data: publicData } =
        supabase.storage
          .from("ai-media")
          .getPublicUrl(filename);

      const videoUrl =
        publicData.publicUrl;

      if (!videoUrl) {
        return json(
          {
            error:
              "Video was generated but its URL could not be created.",
          },
          500,
        );
      }

      console.log(
        "Video generation complete",
        videoUrl,
      );

      /*
       * Your existing mediaUrls() frontend
       * recognizes this HTTPS .mp4 URL.
       */

      return json({
        output: videoUrl,
        media: [videoUrl],
        url: videoUrl,

        provider: "huggingface-fal",
        model:
          "Wan-AI/Wan2.2-TI2V-5B",
      });
    }

    return json(
      { error: "Unsupported generation type." },
      400,
    );
  } catch (error) {
    console.error(
      "AI Media Studio error:",
      error,
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Generation failed.",
      },
      500,
    );
  }
});