/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * 
 * NetSuite → EC2 Middleware → Zoho (Production Version)
 * 
 * This Suitelet:
 * 1. Finds Vendor Bill attachments
 * 2. Sends Base64 files to EC2 middleware (with API key)
 * 3. Middleware converts Base64 → Binary and uploads to Zoho
 * 4. Returns results to NetSuite
 */
define(
  ['N/file', 'N/https', 'N/log', './AGS_ZohoBook_Library.js', 'N/search'],
  function (file, https, log, AGSZohoBookLib, search) {

    function onRequest(context) {

      // ===== CONFIGURATION =====
      var NS_vBill_ID = '545772';
      var zoho_ID = '2950483000000649068';

      // ===== REUSE EXISTING ZOHO CONFIG FROM LIBRARY =====
      var zoho_cud_api = AGSZohoBookLib.zoho_cud_api;
      var OrganizationID = AGSZohoBookLib.OrganizationID;

      // ===== EC2 MIDDLEWARE ENDPOINT (HARDCODED) =====
      var middlewareUrl =
        'http://51.20.245.218:3000/api/convert/base64-to-binary';

      // ===== API KEY (HARDCODED - MATCHES MIDDLEWARE) =====
      var apiKey = 'NSZoho@8080';

      // ===== GET ZOHO TOKEN (ONCE, OUTSIDE LOOP) =====
      var credObj = AGSZohoBookLib.Zoho_mastersetup_rec();
      var transDate = new Date();
      var respObj = JSON.parse(
        AGSZohoBookLib.get_Access_Token(credObj, transDate)
      );

      log.debug('Zoho access token fetched', respObj);

      // ===== SEARCH VENDOR BILL ATTACHMENTS =====
      var vendorbillSearchObj = search.create({
        type: 'vendorbill',
        filters: [
          ['type', 'anyof', 'VendBill'],
          'AND',
          ['internalidnumber', 'equalto', NS_vBill_ID],
          'AND',
          ['mainline', 'is', 'F'],
          'AND',
          ['cogs', 'is', 'F'],
          'AND',
          ['taxline', 'is', 'F'],
          'AND',
          ['file.internalid', 'noneof', '@NONE@']
        ],
        columns: [
          search.createColumn({
            name: 'internalid',
            join: 'file',
            summary: 'GROUP',
            label: 'Internal ID',
            sort: search.Sort.ASC
          })
        ]
      });

      var searchResultCount = vendorbillSearchObj.runPaged().count;
      log.debug('vendorbillSearchObj result count', searchResultCount);

      var results = [];

      // ===== PROCESS EACH ATTACHED FILE =====
      vendorbillSearchObj.run().each(function (result) {

        var fileId = result.getValue({
          name: 'internalid',
          join: 'file',
          summary: 'GROUP',
          label: 'Internal ID'
        });

        var fileObj = file.load({ id: fileId });
        log.debug('fileObj', fileObj);

        var base64Data = fileObj.getContents();
        var mimeType = getMimeType(fileObj.fileType);

        // Skip unsupported file types
        if (!mimeType) {
          log.error('Unsupported file type', {
            fileType: fileObj.fileType,
            fileName: fileObj.name
          });
          results.push({
            fileName: fileObj.name,
            status: 'skipped',
            reason: 'Unsupported file type: ' + fileObj.fileType
          });
          return true;
        }

        // ===== BUILD PAYLOAD FOR MIDDLEWARE =====
        var payload = {
          base64Data: base64Data,
          fileName: fileObj.name,
          mimeType: mimeType,
          forward: {
            url:
              zoho_cud_api +
              'bills/' +
              zoho_ID +
              '/attachment' +
              OrganizationID,
            method: 'POST',
            headers: {
              Authorization: 'Zoho-oauthtoken ' + respObj.access_token,
              Accept: '*/*'
            }
          }
        };

        log.debug('Sending file to EC2 middleware', {
          fileName: fileObj.name,
          mimeType: mimeType,
          base64Length: base64Data.length,
          fileType: fileObj.fileType
        });

        // ===== CALL EC2 MIDDLEWARE (WITH API KEY) =====
        try {
          var response = https.post({
            url: middlewareUrl,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey
            },
            body: JSON.stringify(payload)
          });

          // Parse middleware response to check Zoho upload status
          var middlewareResponse = JSON.parse(response.body);

          log.debug('Middleware response for file: ' + fileObj.name, {
            middlewareStatus: response.code,
            zohoStatus: middlewareResponse.status,
            zohoResponse: middlewareResponse.data
          });

          // Determine success based on Zoho's HTTP status
          var isSuccess = middlewareResponse.status === 200 || middlewareResponse.status === 201;

          results.push({
            fileName: fileObj.name,
            status: isSuccess ? 'success' : 'failed',
            middlewareStatus: response.code,
            zohoStatus: middlewareResponse.status,
            zohoResponse: middlewareResponse.data,
            message: isSuccess
              ? 'File uploaded successfully to Zoho'
              : 'Zoho upload failed with status: ' + middlewareResponse.status
          });

        } catch (e) {
          log.error('Error calling middleware for file: ' + fileObj.name, {
            error: e.toString(),
            errorDetails: e
          });

          results.push({
            fileName: fileObj.name,
            status: 'error',
            error: e.toString(),
            message: 'Failed to call middleware or parse response'
          });
        }

        return true;
      });

      // ===== RETURN FINAL RESULTS =====
      var finalResponse = {
        status: 'completed',
        filesProcessed: results.length,
        timestamp: new Date().toISOString(),
        results: results
      };

      log.debug('Final results summary', finalResponse);
      context.response.write(JSON.stringify(finalResponse));
    }

    // ===== MIME TYPE MAPPING =====
    function getMimeType(nsType) {
      var mimeMap = {
        // Documents
        PDF: 'application/pdf',
        PLAINTEXT: 'text/plain',
        CSV: 'text/csv',
        XMLDOC: 'application/xml',

        // Images
        PNGIMAGE: 'image/png',
        JPGIMAGE: 'image/jpeg',
        GIFIMAGE: 'image/gif',
        TIFFIMAGE: 'image/tiff',
        BMPIMAGE: 'image/bmp',

        // Microsoft Office
        WORD: 'application/msword',
        EXCEL: 'application/vnd.ms-excel',

        // Archives
        ZIP: 'application/zip',
        GZIP: 'application/gzip' // Note: not supported by Zoho API

        // Note: JSON, MP3, HTMLDOC, JAVASCRIPT, STYLESHEET are not supported
        // by Zoho API or cannot be retrieved via getContents()
      };
      return mimeMap[nsType];
    }

    return {
      onRequest: onRequest
    };
  }
);


