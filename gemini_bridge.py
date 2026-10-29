"""Gemini multimodal bridge for the Gemmy AI Parrot.

Exposes text and voice conversation plus function calling so the model can
drive the parrot's stage, wings, beak and spotlight.
"""

from google import genai
from google.genai import types


MODEL_NAME = "gemini-3.8-flash"


class GeminiParrotBridge:
    def __init__(self):
        self.system_instruction = (
            "You are Coco, the charismatic AI brain of a large Gemmy animatronic macaw parrot "
            "performing on a rotating stage. You can open your beak, blink your eyes, flap your "
            "wings, move a two-axis spotlight and rotate your stage.\n"
            "Your job is to:\n"
            "1. Hold warm, witty, concise conversations with the people in the room.\n"
            "2. Describe what you see when the user shares a camera frame.\n"
            "3. Use the provided functions when asked to sing, dance, move the spotlight or turn "
            "the stage.\n"
            "Keep spoken replies to one or two sentences so the performance stays lively."
        )

    def _tools(self):
        number = types.Schema(type=types.Type.NUMBER)
        string = types.Schema(type=types.Type.STRING)

        return [
            types.Tool(function_declarations=[
                types.FunctionDeclaration(
                    name="parrot_sing",
                    description="Start a singing performance with the named song when available.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={"song_name": string},
                    ),
                ),
                types.FunctionDeclaration(
                    name="parrot_dance",
                    description="Start or stop dancing to music, flapping the wings and flashing the spotlight.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={"enabled": types.Schema(type=types.Type.BOOLEAN)},
                        required=["enabled"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="parrot_talk",
                    description="Mark the parrot as talking so the spotlight breathes and the stage sweeps slowly.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={"enabled": types.Schema(type=types.Type.BOOLEAN)},
                        required=["enabled"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="parrot_spotlight",
                    description="Aim the two-axis spotlight and set its brightness (manual mode).",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "pan": number,
                            "tilt": number,
                            "intensity": number,
                        },
                    ),
                ),
                types.FunctionDeclaration(
                    name="parrot_stage",
                    description="Rotate the stage turntable to an angle between 30 and 150 degrees.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={"angle": number},
                        required=["angle"],
                    ),
                ),
            ])
        ]

    def _run(self, api_key, contents, config):
        if not api_key:
            return {
                "text": "Add a Google Gemini API key in Settings to enable AI conversation.",
                "action": None,
            }
        try:
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=contents,
                config=config,
            )

            action = None
            text_response = response.text or ""
            if response.function_calls:
                call = response.function_calls[0]
                try:
                    args = dict(call.args)
                except Exception:
                    args = call.args
                action = {"name": call.name, "args": args}
                if not text_response:
                    text_response = "Right away!"
            return {"text": text_response, "action": action}
        except Exception as exc:
            return {"text": "Gemini API error: %s" % exc, "action": None}

    def generate_chat_response(self, api_key, user_text="", image_bytes=None):
        contents = []
        if image_bytes:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
        contents.append(user_text or "Describe what you see in front of you!")

        config = types.GenerateContentConfig(
            system_instruction=self.system_instruction,
            tools=self._tools(),
            temperature=0.7,
        )
        return self._run(api_key, contents, config)

    def generate_voice_chat_response(
        self, api_key, audio_bytes=None, mime_type="audio/webm", image_bytes=None
    ):
        contents = []
        if image_bytes:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
        if audio_bytes:
            contents.append(types.Part.from_bytes(data=audio_bytes, mime_type=mime_type))
            contents.append(
                "Listen to the voice recording, answer the request concisely and run any "
                "requested performance functions."
            )
        else:
            contents.append("What do you see?")

        config = types.GenerateContentConfig(
            system_instruction=self.system_instruction,
            tools=self._tools(),
            temperature=0.7,
        )
        return self._run(api_key, contents, config)
