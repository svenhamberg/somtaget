<?php
$field_name = $_POST['name'];
$field_business = $_POST['business'];
$field_email = $_POST['email'];
// $field_telephone = $_POST['telephone'];
$field_comment = $_POST['comment'];

$mail_to = 'hamberg.sven@gmail.com';
$subject = 'Konferensanmälan! '.$field_name;

$body_message = 'Deltagare: '.$field_name."\n";
$body_message .= 'Företag: '.$field_business."\n";
$body_message .= 'E-mail: '.$field_email."\n";
// $body_message .= 'Telefon: '.$field_telephone."\n";
$body_message .= 'Risk med 3 ord: '.$field_comment;

$headers = 'From: '.$field_email."\r\n";
$headers .= 'Reply-To: '.$field_email."\r\n";

$mail_status = mail($mail_to, $subject, $body_message, $headers);

if ($mail_status) { ?>
	<script language="javascript" type="text/javascript">
//		alert('Thank you for the message. We will contact you shortly.');
		window.location = 'tack.html';
	</script>
<?php
}
else { ?>
	<script language="javascript" type="text/javascript">
		alert('Något gick snett! Vänligen skicka ett email till hamberg.sven@gmail.com');
//		window.location = 'contact_page.html';
	</script>
<?php
}
?>