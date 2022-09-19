const PRODUCTS_SN = "Products";
const ORDERS_SN = "Orders";
const PAYMENT_SN = "Payments"
const CLIENT_ID = "AZvwKeMtiiPSNRETKZEBOx-KmEeW4U2gegfW-1r0FaqYEBfOdLuY4KT59L9-XspXQfD133_Fm6kI5h9K";
const APP_URL = "https://www.appsheet.com/start/d6a1ba8f-c981-4db6-bccf-c06637c26d0f"

/**
 * Handles GET requests. The page structure is described in the Payment.html
 * project file.
 */
function doGet(e) {
  let page = HtmlService.createTemplateFromFile('Payment.html');
  page.customer_id = e.parameter.customer_id;

  return page.evaluate()
    .setTitle('Payment')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1.0')
    .setFaviconUrl('https://www.appsheet.com/content/img/appicons/procurement.png')
}

/**
 * Includes the given project HTML file in the current HTML project file.
 * Also used to include JavaScript.
 * @param {String} filename Project file name.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
    .getContent();
}

/**
 * Get the customer order for rendering in the web app.
 * @param {String} customer_id to get order details.
 * @return {object} order items and total purchase cost.
 */
function getCustomerOrder(customer_id) {
  const doc = SpreadsheetApp.getActiveSpreadsheet();

  // For performance you might prefer to cache the Product data
  // In this example we get the data from the Google Sheet
  const prod_sheet = doc.getSheetByName(PRODUCTS_SN);
  const [prod_header, ...prod] = prod_sheet.getDataRange().getValues();

  // get the indexes of Products sheet columns
  const prodIdIdx = prod_header.indexOf('Product ID');
  const prodNameIdx = prod_header.indexOf('Name');

  // create a product name lookup array
  // if performance becomes a problem could be cached
  // rather than constructing on each run
  const prod_lookup = prod.reduce((ar, row) => {
    ar[row[prodIdIdx]] = row[prodNameIdx];
    return ar;
  }, []);

  // To build the customer order we get all the orders in the 'cart' sheet 
  // and filter for the customer_id
  const order_sheet = doc.getSheetByName(ORDERS_SN);
  const [orders_header, ...orders] = order_sheet.getDataRange().getValues();
  
  // get the indexes of orders in cart sheet columns
  const orderCustID = orders_header.indexOf('Customer ID');
  const orderProd = orders_header.indexOf('Product');
  const orderQuant = orders_header.indexOf('Quantity');
  const orderTot = orders_header.indexOf('Total');
  const orderStatus = orders_header.indexOf('Order Status');
  
  // get the order for this customer return [product, quantity, line total]
  let order_total = 0;
  const customer_order = orders.reduce((ar, row) => {
    if (row[orderCustID] == customer_id && row[orderStatus] == "IN CART") {
      ar.push({
        product: prod_lookup[row[orderProd]],
        quantity: row[orderQuant],
        total: row[orderTot].toFixed(2)
      });
      order_total += row[orderTot];
    }
    return ar;
  }, []);

  // return the order
  return {
    customer_order: customer_order,
    total: order_total.toFixed(2)
  }
}

/**
 * Record the payment from the web app.
 * @param {String} customer_id to get order details.
 * @param {object} details of the PayPal payment.
 * @return {object} status and transaction id.
 */
function recordPayment(customer_id, details) {
  const doc = SpreadsheetApp.getActiveSpreadsheet();

  // record paypal details in the payments sheet
  details['Customer ID'] = customer_id;

  // Based on https://hawksey.info/blog/2020/04/google-apps-script-patterns-writing-rows-of-data-to-google-sheets-the-v8-way/
  const sheet = doc.getSheetByName(PAYMENT_SN);
  // flatten the json
  const rows = flatten_(details);
  // getting our headers
  const heads = sheet.getDataRange()
    .offset(0, 0, 1)
    .getValues()[0];
  // convert object details into a 2d array
  const tr = heads.map(key => rows[String(key)] || '');

  const lock = LockService.getDocumentLock();
  let status = null;
  const error = [];
  // Using Lock Service to allow concurrent writing
  // @See https://tanaikech.github.io/2021/09/15/concurrent-writing-to-google-spreadsheet-using-form/
  if (lock.tryLock(20000)) {
    try {
      // write result
      sheet.appendRow(tr);
    } catch (e) {
      status = 'error';
      error.push('Could not record payment');
    } finally {
      lock.releaseLock();
      status = 'ok';
    }
  } else {
    status = 'timeout';
    error.push('Timeout - Could not record payment');
  }

  // Note complete items for the customer ID
  const order_sheet = doc.getSheetByName(ORDERS_SN);
  const [orders_header, ...orders] = order_sheet.getDataRange().getValues();

  // get the indexes of Orders sheet columns
  const orderCustID = orders_header.indexOf('Customer ID');
  const orderStatus = orders_header.indexOf('Order Status');
  const orderStatusCol = String.fromCharCode(64+orderStatus+1); // convert column number to letter

  // Find complete orders in the cart complete
  // based on https://stackoverflow.com/a/55719638/1027723 and https://stackoverflow.com/a/63164207/1027723
  const updateRows = orders.reduce((ar, e, i) => {
    if (e[orderCustID] == customer_id && e[orderStatus] == "IN CART") {
      ar.push({range: `'${ORDERS_SN}'!${orderStatusCol}${i + 2}`, values: [[`COMPLETE`]]});
    }
    return ar;
  }, []);

  try {
    // Batch update the Orders sheet with completed purchases
    Sheets.Spreadsheets.Values.batchUpdate({data: updateRows, valueInputOption: "USER_ENTERED"}, doc.getId());
  } catch(e) {
    status = 'error';
    error.push('Could not update orders');
  }
  
  return {
    status: status,
    error: error,
    id: details.id
  }
}

// Based on https://stackoverflow.com/a/54897035/1027723
const flatten_ = (obj, prefix = '', res = {}) =>
  Object.entries(obj).reduce((r, [key, val]) => {
    const k = `${prefix}${key}`;
    if (typeof val === 'object' && val !== null) {
      flatten_(val, `${k}_`, r);
    } else {
      res[k] = val;
    }
    return r;
  }, res);