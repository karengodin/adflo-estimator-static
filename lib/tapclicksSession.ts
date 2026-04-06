export async function getTapClicksSession(instance: any) {
  const loginUrl = `${instance.base_url}/app/dash/session/login`

  const loginRes = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify({
      email: instance.login_email,
      password: instance.password, // you'll decrypt this
    }),
  })

  const setCookie = loginRes.headers.get("set-cookie")

  if (!setCookie) {
    throw new Error("Login failed - no session cookie returned")
  }

  const cookie = setCookie
    .split(",")
    .map((c) => c.split(";")[0])
    .join("; ")

  return {
    baseUrl: instance.base_url,
    cookie,
  }
}