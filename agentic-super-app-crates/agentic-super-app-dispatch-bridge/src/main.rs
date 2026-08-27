use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::env;
use std::io::{self, Write};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Deserialize)]
struct BridgeEvent<'a> {
    dispatch_id: &'a str,
    lease_generation: u64,
    sequence: u64,
    kind: &'a str,
    payload: &'a str,
    nonce: &'a str,
    mac: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let secret = hex_decode(&env::var("AGENTIC_SUPER_APP_DISPATCH_SECRET")?)?;
    let dispatch_id = env::var("AGENTIC_SUPER_APP_DISPATCH_ID")?;
    let lease_generation = env::var("AGENTIC_SUPER_APP_DISPATCH_LEASE")?.parse::<u64>()?;
    let kind = env::args().nth(1).unwrap_or_else(|| "status".to_owned());
    let payload = env::args().nth(2).unwrap_or_default();
    if kind.len() > 64 || payload.len() > 64 * 1024 || dispatch_id.len() > 128 {
        return Err("bridge event exceeds the supported size".into());
    }
    let sequence = env::args()
        .nth(3)
        .map(|value| value.parse::<u64>())
        .transpose()?
        .or_else(|| {
            env::var("AGENTIC_SUPER_APP_DISPATCH_SEQUENCE")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
        })
        .ok_or("a dispatch event sequence is required")?;
    let nonce = uuid::Uuid::now_v7().to_string();
    let canonical =
        format!("{dispatch_id}\n{lease_generation}\n{sequence}\n{kind}\n{payload}\n{nonce}");
    let mut mac = HmacSha256::new_from_slice(&secret)?;
    mac.update(canonical.as_bytes());
    let signature = mac.finalize().into_bytes();
    let mac_hex = signature
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let event = BridgeEvent {
        dispatch_id: &dispatch_id,
        lease_generation,
        sequence,
        kind: &kind,
        payload: &payload,
        nonce: &nonce,
        mac: mac_hex,
    };
    let output = serde_json::to_string(&event)?;
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "AGENTIC_SUPER_APP_EVENT {output}")?;
    stdout.flush()?;
    Ok(())
}

fn hex_decode(value: &str) -> Result<Vec<u8>, &'static str> {
    if value.is_empty() || value.len() > 128 || !value.len().is_multiple_of(2) {
        return Err("dispatch secret is not valid hexadecimal");
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|chunk| {
            let high = hex_value(chunk[0])?;
            let low = hex_value(chunk[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn hex_value(value: u8) -> Result<u8, &'static str> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err("dispatch secret is not valid hexadecimal"),
    }
}

#[cfg(test)]
mod tests {
    use super::hex_decode;

    #[test]
    fn decodes_only_bounded_hex_secrets() {
        assert_eq!(hex_decode("00ff10").unwrap(), vec![0, 255, 16]);
        assert!(hex_decode("").is_err());
        assert!(hex_decode("xyz1").is_err());
        assert!(hex_decode("0").is_err());
    }
}
