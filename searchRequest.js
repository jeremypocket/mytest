
fetch("https://seaman.800best.com/hong-qiao/form/request/pageListByPermit", {
    "headers": {
        "accept": "application/json",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,zh-HK;q=0.7,zh-TW;q=0.6",
        "baggage": "sentry-environment=production,sentry-release=PROD_02-10T07%3A57,sentry-public_key=33e85d3604294dd994cb1ec4ec28334c,sentry-trace_id=8077061e1beb49e2a1f55fdb8cc0ef8d",
        "content-type": "application/json;charset=UTF-8",
        "lang-type": "zh-CN",
        "priority": "u=1, i",
        "request-id": "|5771c75c94034aba83139a6e526121b5.589bf3e7a6a14140",
        "sec-ch-ua": "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sentry-trace": "8077061e1beb49e2a1f55fdb8cc0ef8d-aa637b7afd37c12c",
        "traceparent": "00-5771c75c94034aba83139a6e526121b5-589bf3e7a6a14140-01"
    },
    "referrer": "https://seaman.800best.com/man-web/?layout=BasicLayout&lang=zh-CN&loginUserId=193",
    "body": "{\"beginTime\":\"2021-01-11 00:00:00\",\"endTime\":\"2026-02-11 23:59:59\",\"code\":\"\",\"formId\":94606,\"pageSize\":1000,\"currentPage\":1}",
    "method": "POST",
    "mode": "cors",
    "credentials": "include"
}).then(res => res.json()).then(r => {
    r.pageList.list.forEach(item => {
        const code = item.code;
        fetch("https://seaman.800best.com/hong-qiao/process/apply/getProcessLogs", {
            "headers": {
                "accept": "application/json",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,zh-HK;q=0.7,zh-TW;q=0.6",
                "baggage": "sentry-environment=production,sentry-release=PROD_02-10T07%3A57,sentry-public_key=33e85d3604294dd994cb1ec4ec28334c,sentry-trace_id=8077061e1beb49e2a1f55fdb8cc0ef8d",
                "content-type": "application/json;charset=UTF-8",
                "lang-type": "zh-CN",
                "priority": "u=1, i",
                "request-id": "|5771c75c94034aba83139a6e526121b5.896782bf68f44225",
                "sec-ch-ua": "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"macOS\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "sentry-trace": "8077061e1beb49e2a1f55fdb8cc0ef8d-aa637b7afd37c12c",
                "traceparent": "00-5771c75c94034aba83139a6e526121b5-896782bf68f44225-01"
            },
            "referrer": "https://seaman.800best.com/man-web/?layout=BasicLayout&lang=zh-CN&loginUserId=193",
            "body": `{"serialNum":"${code}"}`,
            "method": "POST",
            "mode": "cors",
            "credentials": "include"
        }).then(r => r.json()).then(r => {
            if (r.vo.reviewers.length > 2) {
                console.log(code)
            }
        })
    })
})

