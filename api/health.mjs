export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    service: "u4b-survey-recognition",
    time: new Date().toISOString()
  });
}
