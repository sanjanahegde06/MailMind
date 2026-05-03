from __future__ import annotations

import base64

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def main() -> None:
    vapid = Vapid()
    vapid.generate_keys()

    public_key = vapid.public_key
    private_key = vapid.private_key

    public_bytes = public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    private_value = private_key.private_numbers().private_value
    private_bytes = private_value.to_bytes(32, "big")

    public_key_b64 = b64url_encode(public_bytes)
    private_key_b64 = b64url_encode(private_bytes)

    print("VAPID_PUBLIC_KEY=", public_key_b64, sep="")
    print("VAPID_PRIVATE_KEY=", private_key_b64, sep="")


if __name__ == "__main__":
    main()
