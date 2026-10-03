# Stockroom

A storefront modelled on Amazon's flows: browse, search, product page, cart, checkout and orders, for a visitor with no account.

## Language

**Keyset page**:
One page of a list, such as search results or order history, reached only through Next and Previous from the page beside it, never by number.
_Avoid_: offset page, numbered page

**Checkout**:
Turning the visitor's cart and shipping details into a placed order, or into the reason it was not placed.
_Avoid_: purchase, payment

**Short item**:
A cart line asking for more than is in stock at the moment the order is placed.
_Avoid_: out-of-stock item (a short item may still have some stock)
